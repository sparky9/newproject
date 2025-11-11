import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface WizardProgressProps {
  steps: string[];
  currentStep: number;
}

export function WizardProgress({ steps, currentStep }: WizardProgressProps) {
  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div key={step} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                {/* Step circle */}
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors',
                    isCompleted &&
                      'bg-primary border-primary text-primary-foreground',
                    isCurrent &&
                      'border-primary text-primary bg-background',
                    !isCompleted &&
                      !isCurrent &&
                      'border-muted text-muted-foreground'
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <span className="text-sm font-medium">{index + 1}</span>
                  )}
                </div>

                {/* Step label */}
                <span
                  className={cn(
                    'text-xs mt-2 text-center max-w-[100px]',
                    isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}
                >
                  {step}
                </span>
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-2 transition-colors',
                    isCompleted ? 'bg-primary' : 'bg-muted'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
