import React, { useState } from 'react';
import { Trash2, Edit2, Check, X, Plus } from 'lucide-react';

export type Phase2PlanEditorProps = {
  steps: string[];
  onDeleteStep: (index: number) => void;
  onUpdateStep: (index: number, newText: string) => void;
  onAddStep: (text: string) => void;
  onConfirmProceed: () => void;
  onBack?: () => void;
  disabled?: boolean;
};

export function Phase2PlanEditor(props: Phase2PlanEditorProps) {
  const { steps, onDeleteStep, onUpdateStep, onAddStep, onConfirmProceed, onBack, disabled } = props;
  const [editingIndex, setEditingPhase] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [newStepText, setNewStepText] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const startEditing = (index: number, text: string) => {
    setEditingPhase(index);
    setEditText(text);
  };

  const cancelEditing = () => {
    setEditingPhase(null);
    setEditText('');
  };

  const saveEdit = (index: number) => {
    if (editText.trim()) {
      onUpdateStep(index, editText.trim());
    }
    cancelEditing();
  };

  const handleAddStep = () => {
    if (newStepText.trim()) {
      onAddStep(newStepText.trim());
      setNewStepText('');
      setIsAdding(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>PHASE 2: REPRODUCTION PLAN (BDD)</h3>
        {!isAdding && (
          <button 
            className="btn-secondary" 
            style={{ fontSize: '0.7rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => setIsAdding(true)}
            disabled={disabled}
          >
            <Plus size={14} /> ADD STEP
          </button>
        )}
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
        Review and refine the AI-generated BDD steps. You can edit, delete, or add new steps.
      </p>

      <div className="plan-scroll" style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
        {steps.map((step, i) => (
          <div
            key={`${i}-${step}`}
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              padding: '12px',
              borderLeft: `2px solid ${editingIndex === i ? 'var(--accent-emerald)' : 'var(--accent-primary)'}`,
              background: editingIndex === i ? 'rgba(16, 185, 129, 0.05)' : 'rgba(45, 212, 191, 0.05)',
              marginBottom: '10px',
              borderRadius: '0 8px 8px 0',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: editingIndex === i ? 'var(--accent-emerald)' : 'var(--accent-primary)' }}>
                Step {i + 1}
              </div>
              
              {editingIndex === i ? (
                <textarea
                  className="dashboard-input"
                  style={{ width: '100%', marginTop: '8px', fontSize: '0.8rem', minHeight: '60px', background: 'rgba(0,0,0,0.2)' }}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                />
              ) : (
                <div style={{ fontSize: '0.8rem', marginTop: '6px', lineHeight: 1.4 }}>{step}</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              {editingIndex === i ? (
                <>
                  <button className="icon-btn" style={{ color: 'var(--accent-emerald)' }} onClick={() => saveEdit(i)} title="Save">
                    <Check size={16} />
                  </button>
                  <button className="icon-btn" onClick={cancelEditing} title="Cancel">
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  <button className="icon-btn" onClick={() => startEditing(i, step)} disabled={disabled} title="Edit step">
                    <Edit2 size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    style={{ color: 'var(--accent-rose)' }}
                    onClick={() => onDeleteStep(i)}
                    disabled={disabled}
                    title="Delete step"
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        {isAdding && (
          <div
            style={{
              padding: '12px',
              borderLeft: '2px dashed var(--accent-primary)',
              background: 'rgba(255, 255, 255, 0.02)',
              marginBottom: '10px',
              borderRadius: '0 8px 8px 0',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--accent-primary)' }}>
              New Step
            </div>
            <textarea
              className="dashboard-input"
              placeholder="Enter BDD step (e.g., Given user navigates to...)"
              style={{ width: '100%', marginTop: '8px', fontSize: '0.8rem', minHeight: '60px', background: 'rgba(0,0,0,0.2)' }}
              value={newStepText}
              onChange={(e) => setNewStepText(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" style={{ fontSize: '0.7rem', padding: '4px 12px' }} onClick={() => setIsAdding(false)}>CANCEL</button>
              <button className="btn-primary" style={{ fontSize: '0.7rem', padding: '4px 12px' }} onClick={handleAddStep} disabled={!newStepText.trim()}>ADD STEP</button>
            </div>
          </div>
        )}

        {steps.length === 0 && !isAdding && (
          <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px 10px' }}>
            No steps remaining. Add a new step or go back.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '2rem' }}>
        <button className="btn-secondary" onClick={onBack} style={{ flex: 1 }} disabled={disabled || !onBack}>
          BACK
        </button>
        <button
          className="btn-primary"
          onClick={onConfirmProceed}
          style={{ flex: 2 }}
          disabled={disabled || steps.length === 0 || editingIndex !== null || isAdding}
        >
          CONFIRM &amp; PROCEED TO PHASE 3
        </button>
      </div>
    </>
  );
}
