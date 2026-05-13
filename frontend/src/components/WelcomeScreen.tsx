import { Sparkles } from 'lucide-react';

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void;
}

const SUGGESTIONS = [
  {
    icon: '🎯',
    title: 'Start Testing Jira Ticket',
    description: 'Analyze a Jira ticket and generate test cases',
    text: 'Start testing Jira ticket',
  },
  {
    icon: '📋',
    title: 'Generate Test Cases',
    description: 'Create automated test cases from requirements',
    text: 'Generate test cases',
  },
  {
    icon: '🔍',
    title: 'View Analytics',
    description: 'Check token usage and AI model performance',
    text: 'Show me analytics',
  },
  {
    icon: '🧪',
    title: 'Run Regression Suite',
    description: 'Execute the full regression test suite',
    text: 'Run regression tests',
  },
];

export function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-primary/10 mb-6">
          <Sparkles className="w-8 h-8 text-accent-primary" />
        </div>

        {/* Greeting */}
        <h2 className="text-2xl font-bold text-white mb-2">
          Welcome to Go-Hybrid AI
        </h2>
        <p className="text-gray-400 mb-8 max-w-md mx-auto">
          Your intelligent test automation assistant. Mention a Jira ticket to start testing,
          or try one of these suggestions.
        </p>

        {/* Suggestions Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.title}
              onClick={() => onSuggestionClick(suggestion.text)}
              className="flex flex-col items-start p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all text-left group"
            >
              <span className="text-2xl mb-2">{suggestion.icon}</span>
              <span className="text-sm font-medium text-white group-hover:text-accent-primary transition-colors">
                {suggestion.title}
              </span>
              <span className="text-xs text-gray-500 mt-1">
                {suggestion.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
