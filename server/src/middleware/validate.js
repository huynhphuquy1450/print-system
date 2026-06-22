'use strict';

/**
 * Validator đơn giản: kiểm tra required fields và basic types
 * Trả về { valid: true, value } hoặc { valid: false, error }
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    const data = { ...req.body };

    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${field}' is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push(`Field '${field}' must be a string`);
        continue;
      }
      if (rules.type === 'number' && typeof value !== 'number') {
        errors.push(`Field '${field}' must be a number`);
        continue;
      }
      if (rules.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
        errors.push(`Field '${field}' must be an object`);
        continue;
      }
      if (rules.type === 'array' && !Array.isArray(value)) {
        errors.push(`Field '${field}' must be an array`);
        continue;
      }

      if (rules.minLength !== undefined && typeof value === 'string' && value.length < rules.minLength) {
        errors.push(`Field '${field}' must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && typeof value === 'string' && value.length > rules.maxLength) {
        errors.push(`Field '${field}' must be at most ${rules.maxLength} characters`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    next();
  };
}

module.exports = { validate };