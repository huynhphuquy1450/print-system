import styles from './StatusBadge.module.css';

const MAP = {
  // Job statuses
  pending:      styles.pending,
  sent:         styles.sent,
  printed:      styles.printed,
  failed:       styles.failed,
  // Printer / branch statuses
  online:       styles.online,
  out_of_paper: styles.outOfPaper,
  paper_jam:    styles.paperJam,
  offline:      styles.offline,
  unknown:      styles.unknown,
  // Client (tenant) active flag — tái dùng màu online/offline
  active:       styles.online,
  inactive:     styles.offline,
};

const LABEL = {
  online:       'Online',
  out_of_paper: 'Hết giấy',
  paper_jam:    'Kẹt giấy',
  offline:      'Offline',
  unknown:      'Không rõ',
  active:       'Hoạt động',
  inactive:     'Vô hiệu',
};

/**
 * @param {{ status: string }} props
 */
export default function StatusBadge({ status }) {
  const cls = MAP[status] || styles.unknown;
  const label = LABEL[status] || status;
  return <span className={`${styles.badge} ${cls}`}>{label}</span>;
}
