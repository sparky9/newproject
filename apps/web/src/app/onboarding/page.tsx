'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { WizardProgress } from '@/components/onboarding/wizard-progress';
import { WelcomeStep } from './steps/welcome';
import { BusinessProfileStep } from './steps/business-profile';
import { ConnectFirstIntegrationStep } from './steps/connect-first-integration';
import { createApiClient } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { BusinessSize, BusinessStage } from '@ocsuite/types';

const steps = ['Welcome', 'Business Profile', 'Connect Integration'];

interface OnboardingData {
  companyName: string;
  industry: string;
  size: BusinessSize | '';
  stage: BusinessStage | '';
}

export default function OnboardingPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<Partial<OnboardingData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleNext = () => {
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleBusinessProfileNext = async (data: OnboardingData) => {
    setOnboardingData(data);
    setCurrentStep(2);
  };

  const handleSkipIntegration = async () => {
    await completeOnboarding();
  };

  const handleIntegrationNext = async () => {
    await completeOnboarding();
  };

  const completeOnboarding = async () => {
    setIsSubmitting(true);

    try {
      const api = createApiClient(getToken);

      // Create tenant with company name
      const slug = onboardingData.companyName
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'my-company';

      await api.createTenant({
        name: onboardingData.companyName || 'My Company',
        slug,
      });

      // Create business profile if data was provided
      if (onboardingData.industry || onboardingData.size || onboardingData.stage) {
        await api.createBusinessProfile({
          industry: onboardingData.industry || undefined,
          size: onboardingData.size || undefined,
          stage: onboardingData.stage || undefined,
        });
      }

      toast({
        title: 'Welcome aboard!',
        description: 'Your account has been set up successfully.',
      });

      // Redirect to dashboard
      router.push('/dashboard');
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      toast({
        title: 'Error',
        description: 'Failed to complete setup. Please try again.',
        variant: 'destructive',
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-8 px-4">
        {/* Progress indicator */}
        <WizardProgress steps={steps} currentStep={currentStep} />

        {/* Step content */}
        <div className="mt-8">
          {currentStep === 0 && <WelcomeStep onNext={handleNext} />}

          {currentStep === 1 && (
            <BusinessProfileStep
              onNext={handleBusinessProfileNext}
              onBack={handleBack}
              initialData={onboardingData}
            />
          )}

          {currentStep === 2 && (
            <ConnectFirstIntegrationStep
              onNext={handleIntegrationNext}
              onBack={handleBack}
              onSkip={handleSkipIntegration}
            />
          )}
        </div>
      </div>
    </div>
  );
}
