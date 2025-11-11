import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-3xl">Welcome to C-Suite Pivot!</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center text-muted-foreground space-y-4">
          <p className="text-lg">
            Your AI-powered board of directors is ready to help you make better
            decisions.
          </p>
          <div className="grid gap-4 md:grid-cols-3 text-sm">
            <div className="p-4 rounded-lg bg-muted/50">
              <h3 className="font-semibold mb-2">Strategic Insights</h3>
              <p>
                Get CEO-level strategic advice for your business challenges
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <h3 className="font-semibold mb-2">Integrated Intelligence</h3>
              <p>Connect your tools to give your AI team full context</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <h3 className="font-semibold mb-2">Actionable Tasks</h3>
              <p>Your AI board can execute tasks and automate workflows</p>
            </div>
          </div>
        </div>

        <div className="flex justify-center pt-4">
          <Button onClick={onNext} size="lg">
            Get Started
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
