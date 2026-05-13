import { X, Sliders } from 'lucide-react';

interface AdvancedSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  maxScenarios: number;
  onMaxScenariosChange: (v: number) => void;
  maxTestCases: number;
  onMaxTestCasesChange: (v: number) => void;
  memoryEnhancement: boolean;
  onMemoryEnhancementChange: (v: boolean) => void;
  projectInstructions: string;
  onProjectInstructionsChange: (v: string) => void;
}

export function AdvancedSettingsPanel({
  isOpen,
  onClose,
  maxScenarios,
  onMaxScenariosChange,
  maxTestCases,
  onMaxTestCasesChange,
  memoryEnhancement,
  onMemoryEnhancementChange,
  projectInstructions,
  onProjectInstructionsChange,
}: AdvancedSettingsPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute bottom-full left-4 right-4 mb-2 z-30">
      <div className="bg-gray-900/95 border border-white/10 rounded-xl shadow-2xl backdrop-blur-sm p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-accent-primary" />
            <h3 className="text-sm font-semibold text-white">Advanced Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            aria-label="Close advanced settings"
          >
            <X className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Max Scenarios */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">Max Test Scenarios</label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxScenarios}
              onChange={(e) => onMaxScenariosChange(parseInt(e.target.value) || 5)}
              className="w-20 px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
            />
          </div>

          {/* Max Test Cases */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">Max Test Cases per Scenario</label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxTestCases}
              onChange={(e) => onMaxTestCasesChange(parseInt(e.target.value) || 5)}
              className="w-20 px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
            />
          </div>

          {/* Memory Enhancement */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">Memory Enhancement</label>
            <button
              onClick={() => onMemoryEnhancementChange(!memoryEnhancement)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                memoryEnhancement ? 'bg-accent-primary' : 'bg-white/20'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  memoryEnhancement ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Project Instructions */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Project Instructions
            </label>
            <textarea
              value={projectInstructions}
              onChange={(e) => onProjectInstructionsChange(e.target.value)}
              rows={3}
              className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
              placeholder="Add project-specific instructions for the AI..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
