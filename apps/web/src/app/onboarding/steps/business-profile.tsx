'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BusinessSize, BusinessStage } from '@ocsuite/types';

interface BusinessProfileData {
  companyName: string;
  industry: string;
  size: BusinessSize | '';
  stage: BusinessStage | '';
}

interface BusinessProfileStepProps {
  onNext: (data: BusinessProfileData) => void;
  onBack: () => void;
  initialData?: Partial<BusinessProfileData>;
}

export function BusinessProfileStep({
  onNext,
  onBack,
  initialData,
}: BusinessProfileStepProps) {
  const [formData, setFormData] = useState<BusinessProfileData>({
    companyName: initialData?.companyName || '',
    industry: initialData?.industry || '',
    size: initialData?.size || '',
    stage: initialData?.stage || '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof BusinessProfileData, string>>>({});

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof BusinessProfileData, string>> = {};

    if (!formData.companyName.trim()) {
      newErrors.companyName = 'Company name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onNext(formData);
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Tell us about your business</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Company Name */}
          <div className="space-y-2">
            <Label htmlFor="companyName">
              Company Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="companyName"
              value={formData.companyName}
              onChange={(e) =>
                setFormData({ ...formData, companyName: e.target.value })
              }
              placeholder="Enter your company name"
              className={errors.companyName ? 'border-destructive' : ''}
            />
            {errors.companyName && (
              <p className="text-sm text-destructive">{errors.companyName}</p>
            )}
          </div>

          {/* Industry */}
          <div className="space-y-2">
            <Label htmlFor="industry">Industry</Label>
            <Input
              id="industry"
              value={formData.industry}
              onChange={(e) =>
                setFormData({ ...formData, industry: e.target.value })
              }
              placeholder="e.g., SaaS, E-commerce, Consulting"
            />
          </div>

          {/* Business Size */}
          <div className="space-y-2">
            <Label htmlFor="size">Business Size</Label>
            <Select
              value={formData.size}
              onValueChange={(value) =>
                setFormData({ ...formData, size: value as BusinessSize })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select business size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solo">Just me (Solo)</SelectItem>
                <SelectItem value="small">2-10 employees</SelectItem>
                <SelectItem value="medium">11-50 employees</SelectItem>
                <SelectItem value="large">51+ employees</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Business Stage */}
          <div className="space-y-2">
            <Label htmlFor="stage">Business Stage</Label>
            <Select
              value={formData.stage}
              onValueChange={(value) =>
                setFormData({ ...formData, stage: value as BusinessStage })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select business stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="idea">Idea / Pre-launch</SelectItem>
                <SelectItem value="startup">Startup (0-2 years)</SelectItem>
                <SelectItem value="growth">Growth Stage</SelectItem>
                <SelectItem value="mature">Established / Mature</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-4">
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button type="submit">Continue</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
