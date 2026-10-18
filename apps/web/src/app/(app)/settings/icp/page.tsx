'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';

import { fetchICPProfile, updateICPProfile, type ICPProfile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';

const SENIORITY_OPTIONS = [
  { value: 'EXECUTIVE', label: 'Executive (C-Suite)' },
  { value: 'VP', label: 'VP' },
  { value: 'DIRECTOR', label: 'Director' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'INDIVIDUAL_CONTRIBUTOR', label: 'Individual Contributor' },
];

const COMPANY_SIZE_OPTIONS = [
  '1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+',
];

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('');

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault();
      if (!values.includes(input.trim())) onChange([...values, input.trim()]);
      setInput('');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1">
            {v}
            <button className="ml-0.5 hover:text-destructive" onClick={() => onChange(values.filter(x => x !== v))}>&times;</button>
          </Badge>
        ))}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    </div>
  );
}

export default function ICPSettingsPage() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: ['icp-profile'], queryFn: fetchICPProfile });

  const [form, setForm] = useState<ICPProfile>({
    targetIndustries: [],
    targetCountries: [],
    targetCompanySizes: [],
    targetJobTitles: [],
    targetSeniorities: [],
    targetKeywords: [],
    minWebsiteScore: null,
    minOpportunityScore: null,
    requireVerifiedEmail: false,
    weights: { industry: 25, location: 15, companySize: 15, jobTitle: 25, seniority: 20 },
  });

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () => updateICPProfile(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['icp-profile'] });
      toast.success('ICP profile saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function updateWeight(key: keyof ICPProfile['weights'], value: number) {
    const w = { ...form.weights };
    const oldVal = w[key];
    const diff = value - oldVal;
    w[key] = value;

    const otherKeys = (Object.keys(w) as (keyof typeof w)[]).filter(k => k !== key);
    const otherTotal = otherKeys.reduce((s, k) => s + w[k], 0);
    if (otherTotal > 0) {
      for (const k of otherKeys) {
        w[k] = Math.max(0, Math.round(w[k] - (diff * w[k] / otherTotal)));
      }
    }

    const total = Object.values(w).reduce((s, v) => s + v, 0);
    if (total !== 100 && otherKeys.length > 0) {
      w[otherKeys[0]!] += 100 - total;
    }

    setForm({ ...form, weights: w });
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const weightsTotal = Object.values(form.weights).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Ideal Customer Profile</h2>
        <p className="text-sm text-muted-foreground">Define your target audience for lead scoring and enrichment.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target Criteria</CardTitle>
          <CardDescription>Leads matching these criteria will score higher. Leave a field empty to match all.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Target Industries</Label>
            <TagInput values={form.targetIndustries} onChange={(v) => setForm({ ...form, targetIndustries: v })} placeholder="Type industry and press Enter" />
          </div>

          <div className="space-y-2">
            <Label>Target Countries</Label>
            <TagInput values={form.targetCountries} onChange={(v) => setForm({ ...form, targetCountries: v })} placeholder="Type country and press Enter" />
          </div>

          <div className="space-y-2">
            <Label>Company Sizes</Label>
            <div className="flex flex-wrap gap-2">
              {COMPANY_SIZE_OPTIONS.map((size) => (
                <Badge
                  key={size}
                  variant={form.targetCompanySizes.includes(size) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => {
                    const sizes = form.targetCompanySizes.includes(size)
                      ? form.targetCompanySizes.filter(s => s !== size)
                      : [...form.targetCompanySizes, size];
                    setForm({ ...form, targetCompanySizes: sizes });
                  }}
                >
                  {size}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Target Job Titles</Label>
            <TagInput values={form.targetJobTitles} onChange={(v) => setForm({ ...form, targetJobTitles: v })} placeholder="Type job title and press Enter" />
          </div>

          <div className="space-y-2">
            <Label>Target Seniorities</Label>
            <div className="flex flex-wrap gap-2">
              {SENIORITY_OPTIONS.map((s) => (
                <Badge
                  key={s.value}
                  variant={form.targetSeniorities.includes(s.value) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => {
                    const seniorities = form.targetSeniorities.includes(s.value)
                      ? form.targetSeniorities.filter(x => x !== s.value)
                      : [...form.targetSeniorities, s.value];
                    setForm({ ...form, targetSeniorities: seniorities });
                  }}
                >
                  {s.label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="requireVerified"
              checked={form.requireVerifiedEmail}
              onCheckedChange={(checked) => setForm({ ...form, requireVerifiedEmail: !!checked })}
            />
            <Label htmlFor="requireVerified">Require verified email</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scoring Weights</CardTitle>
          <CardDescription>How much each dimension contributes to the ICP Fit score. Must sum to 100. ({weightsTotal}/100)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {([
            ['industry', 'Industry'],
            ['location', 'Location'],
            ['companySize', 'Company Size'],
            ['jobTitle', 'Job Title'],
            ['seniority', 'Seniority'],
          ] as const).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <span className="text-muted-foreground">{form.weights[key]}%</span>
              </div>
              <Slider
                value={[form.weights[key]]}
                onValueChange={([v]) => updateWeight(key, v!)}
                max={100}
                step={5}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || weightsTotal !== 100}>
        <Save className="mr-1 h-4 w-4" />
        {saveMutation.isPending ? 'Saving...' : 'Save ICP Profile'}
      </Button>
    </div>
  );
}
