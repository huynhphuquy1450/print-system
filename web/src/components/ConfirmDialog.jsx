import Modal from './Modal.jsx';

/**
 * @param {{ open:boolean, title:string, message:string, confirmText?:string, onConfirm:()=>void, onCancel:()=>void, danger?:boolean }} props
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Xác nhận',
  onConfirm,
  onCancel,
  danger = false,
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>Hủy</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-accent'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--color-fg)' }}>{message}</p>
    </Modal>
  );
}
