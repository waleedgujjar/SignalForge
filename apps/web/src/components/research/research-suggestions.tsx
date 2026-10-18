'use client';

import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { ResearchSuggestion, ResearchSuggestionKey } from '@/lib/api';

/** A concrete, executable action — a suggestion is only checkable when one resolves. */
export type SuggestionAction =
  | { kind: 'approve'; researchId: string }
  | { kind: 'start'; companyUrl?: string; personUrl?: string }
  | { kind: 'analyze-website' };

export interface ResolvedSuggestion {
  action: SuggestionAction | null;
  /** Short explanation of what will happen (or why nothing can). */
  hint: string;
}

interface Props {
  suggestions: ResearchSuggestion[] | undefined;
  isLoading: boolean;
  isRunning: boolean;
  resolve: (suggestion: ResearchSuggestion) => ResolvedSuggestion;
  onRun: (actions: SuggestionAction[]) => void;
  idPrefix: string;
}

export function ResearchSuggestions({ suggestions, isLoading, isRunning, resolve, onRun, idPrefix }: Props) {
  const [selected, setSelected] = useState<Set<ResearchSuggestionKey>>(() => new Set());

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return <p className="text-xs text-muted-foreground">No research suggestions for this lead.</p>;
  }

  const resolved = suggestions.map((suggestion) => ({ suggestion, ...resolve(suggestion) }));
  const selectable = resolved.filter((r) => r.suggestion.available && !r.suggestion.done && r.action !== null);
  const selectedActions = selectable
    .filter((r) => selected.has(r.suggestion.key))
    .map((r) => r.action)
    .filter((a): a is SuggestionAction => a !== null);

  function toggle(key: ResearchSuggestionKey, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {resolved.map(({ suggestion, action, hint }) => {
          const id = `${idPrefix}-suggestion-${suggestion.key}`;
          const checkable = suggestion.available && !suggestion.done && action !== null;
          return (
            <li key={suggestion.key} className="flex items-start gap-3 rounded-md border border-border p-3">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={selected.has(suggestion.key)}
                disabled={!checkable || isRunning}
                onCheckedChange={(v) => toggle(suggestion.key, v === true)}
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={id} className={checkable ? 'text-sm' : 'text-sm text-muted-foreground'}>
                    {suggestion.label}
                  </Label>
                  {suggestion.done ? (
                    <Badge variant="success" className="text-xs">Done</Badge>
                  ) : !suggestion.available || action === null ? (
                    <Badge variant="outline" className="text-xs">Not available</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
                {!suggestion.done && <p className="text-xs text-muted-foreground/80">{hint}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {selectable.length > 0 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={selectedActions.length === 0 || isRunning}
            onClick={() => {
              onRun(selectedActions);
              setSelected(new Set());
            }}
          >
            {isRunning ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            Run selected ({selectedActions.length})
          </Button>
        </div>
      )}
    </div>
  );
}
