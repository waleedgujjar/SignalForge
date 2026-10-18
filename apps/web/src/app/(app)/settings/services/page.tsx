'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Pencil, Sparkles } from 'lucide-react';

import {
  fetchServiceCatalog, createService, updateService, deleteService, seedServiceCatalog,
  type ServiceCatalogEntry,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export default function ServiceCatalogPage() {
  const queryClient = useQueryClient();
  const { data: services, isLoading } = useQuery({ queryKey: ['service-catalog'], queryFn: fetchServiceCatalog });

  const [showDialog, setShowDialog] = useState(false);
  const [editingService, setEditingService] = useState<ServiceCatalogEntry | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [signals, setSignals] = useState('');

  const seedMutation = useMutation({
    mutationFn: seedServiceCatalog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-catalog'] });
      toast.success('Default services added');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; matchingSignals?: string[] }) => createService(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-catalog'] });
      setShowDialog(false);
      toast.success('Service added');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; description: string; matchingSignals: string[]; enabled: boolean }> }) => updateService(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-catalog'] });
      setShowDialog(false);
      toast.success('Service updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteService,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-catalog'] });
      toast.success('Service deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openAdd() {
    setEditingService(null);
    setName('');
    setDescription('');
    setSignals('');
    setShowDialog(true);
  }

  function openEdit(svc: ServiceCatalogEntry) {
    setEditingService(svc);
    setName(svc.name);
    setDescription(svc.description ?? '');
    setSignals((svc.matchingSignals ?? []).join(', '));
    setShowDialog(true);
  }

  function handleSave() {
    const matchingSignals = signals.split(',').map(s => s.trim()).filter(Boolean);
    if (editingService) {
      updateMutation.mutate({ id: editingService.id, data: { name, description: description || undefined, matchingSignals } });
    } else {
      createMutation.mutate({ name, description: description || undefined, matchingSignals });
    }
  }

  function toggleEnabled(svc: ServiceCatalogEntry) {
    updateMutation.mutate({ id: svc.id, data: { enabled: !svc.enabled } });
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Service Catalog</h2>
          <p className="text-sm text-muted-foreground">Define the services you offer. These are matched against lead signals during enrichment.</p>
        </div>
        <div className="flex gap-2">
          {(!services || services.length === 0) && (
            <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <Sparkles className="mr-1 h-4 w-4" /> Seed Defaults
            </Button>
          )}
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1 h-4 w-4" /> Add Service
          </Button>
        </div>
      </div>

      {services && services.length > 0 ? (
        <div className="space-y-3">
          {services.map((svc) => (
            <Card key={svc.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm">{svc.name}</h3>
                    {!svc.enabled && <Badge variant="outline" className="text-xs">Disabled</Badge>}
                  </div>
                  {svc.description && <p className="text-xs text-muted-foreground">{svc.description}</p>}
                  {svc.matchingSignals && (svc.matchingSignals as string[]).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(svc.matchingSignals as string[]).map((s, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <Switch checked={svc.enabled} onCheckedChange={() => toggleEnabled(svc)} />
                  <Button variant="ghost" size="sm" onClick={() => openEdit(svc)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(svc.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">No services defined yet.</p>
            <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <Sparkles className="mr-1 h-4 w-4" /> Add Default Services
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingService ? 'Edit Service' : 'Add Service'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website Redesign" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this service covers..." />
            </div>
            <div className="space-y-2">
              <Label>Matching Signals (comma-separated)</Label>
              <Input value={signals} onChange={(e) => setSignals(e.target.value)} placeholder="e.g. poor seo, missing meta, low score" />
              <p className="text-xs text-muted-foreground">Keywords that match against website findings and lead data to recommend this service.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
