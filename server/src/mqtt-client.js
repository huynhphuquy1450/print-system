'use strict';

const mqtt = require('mqtt');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

class MqttClient {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connecting = false;
  }

  connect() {
    if (this.connecting) return;
    this.connecting = true;

    const opts = {
      clientId: config.mqtt.clientId,
      username: config.mqtt.username,
      password: config.mqtt.password,
      reconnectPeriod: config.mqtt.reconnectPeriod,
      connectTimeout: config.mqtt.connectTimeout,
      clean: true,
    };

    // TLS: nếu URL là mqtts:// → load ca cert
    if (config.mqtt.url.startsWith('mqtts://') && config.mqtt.caFile) {
      try {
        opts.ca = fs.readFileSync(config.mqtt.caFile);
      } catch (e) {
        logger.warn('Could not read MQTT CA file, TLS may fail', {
          caFile: config.mqtt.caFile,
          err: e.message,
        });
      }
      opts.rejectUnauthorized = config.mqtt.rejectUnauthorized;
    }

    logger.info('Connecting to MQTT broker', {
      url: config.mqtt.url,
      clientId: config.mqtt.clientId,
    });

    this.client = mqtt.connect(config.mqtt.url, opts);

    this.client.on('connect', () => {
      this.connected = true;
      this.connecting = false;
      logger.info('MQTT connected');

      // Subscribe status topic để log các status từ agent (optional)
      this.client.subscribe(`${config.mqtt.topicPrefix}/status`, { qos: config.mqtt.qos }, (err) => {
        if (err) {
          logger.error('MQTT subscribe error', { err: err.message });
        } else {
          logger.debug('Subscribed to status topic');
        }
      });
    });

    this.client.on('reconnect', () => {
      logger.debug('MQTT reconnecting...');
    });

    this.client.on('close', () => {
      this.connected = false;
      logger.warn('MQTT disconnected');
    });

    this.client.on('offline', () => {
      this.connected = false;
      logger.warn('MQTT offline');
    });

    this.client.on('error', (err) => {
      this.connecting = false;
      logger.error('MQTT error', { err: err.message });
    });

    this.client.on('message', (topic, payload) => {
      // Log status messages from agents
      try {
        const data = JSON.parse(payload.toString());
        logger.debug('MQTT message received', { topic, data });
      } catch (e) {
        logger.debug('MQTT non-JSON message', { topic, payloadLen: payload.length });
      }
    });
  }

  /**
   * Publish job tới branch's jobs topic
   * Returns Promise<boolean> - true nếu publish thành công
   */
  publishJob(branchId, payload) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('MQTT not connected'));
      }
      const topic = config.jobTopic(branchId);
      const data = JSON.stringify(payload);
      this.client.publish(topic, data, { qos: config.mqtt.qos }, (err) => {
        if (err) {
          logger.error('Publish job failed', { topic, err: err.message });
          return reject(err);
        }
        logger.info('Job published', { topic, job_id: payload.job_id });
        resolve(true);
      });
    });
  }

  /**
   * Publish status (cho HQ monitor hoặc debug)
   */
  publishStatus(payload) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('MQTT not connected'));
      }
      const topic = config.statusTopic();
      this.client.publish(topic, JSON.stringify(payload), { qos: config.mqtt.qos }, (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  async disconnect() {
    if (this.client) {
      await new Promise((resolve) => {
        this.client.end(false, {}, () => resolve());
      });
      logger.info('MQTT disconnected gracefully');
    }
  }

  isConnected() {
    return this.connected;
  }
}

module.exports = new MqttClient();