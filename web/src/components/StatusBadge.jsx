import styles from './StatusBadge.module.css';

const MAP = {
  pending:  styles.pending,
  sent:     styles.sent,
  printed:  styles.printed,
  failed:   styles.failed,
};

/**
 * @param {{ status: 'pending'|'sent'|'printed'|'failed'|string }} props
 */
export default function StatusBadge({ status }) {
  const cls = MAP[status] || styles.pending;
  return <span className={`${styles.badge} ${cls}`}>{status}</span>;
}
