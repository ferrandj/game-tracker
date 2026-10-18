import { Modal } from './Modal';

export function Confirm({ title, children, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; children: React.ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="confirm">{children}</div>
      <div className="actions">
        <button type="button" className="btn" data-autofocus onClick={onCancel}>Annuler</button>
        <button type="button" className={'btn ' + (danger ? 'btn--danger' : 'btn--primary')} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
