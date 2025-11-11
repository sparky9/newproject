'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  KnowledgeEntryPreview,
  KnowledgeIngestionSummary,
  KnowledgeNotePayload,
  KnowledgeSourceListResponse,
  KnowledgeSourceSummary,
  KnowledgeUploadPayload,
  KnowledgeSearchResult,
  createApiClient,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowUpRight,
  Download,
  FileText,
  Loader2,
  Search,
  Trash,
  Upload,
  Users,
  Copy,
  Check,
} from 'lucide-react';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import type {
  KnowledgeRetentionPolicy,
  KnowledgeSourceType,
  KnowledgeStorageStrategy,
} from '@ocsuite/types';

const PERSONA_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ceo', label: 'CEO' },
  { value: 'cfo', label: 'CFO' },
  { value: 'cmo', label: 'CMO' },
  { value: 'cto', label: 'CTO' },
];

const RETENTION_OPTIONS: Array<{ value: KnowledgeRetentionPolicy; label: string }> = [
  { value: 'retain_indefinitely', label: 'Retain indefinitely' },
  { value: 'rolling_90_days', label: 'Rolling 90 days' },
  { value: 'manual_purge', label: 'Manual purge' },
];

const STORAGE_OPTIONS: Array<{ value: KnowledgeStorageStrategy; label: string }> = [
  { value: 'managed_postgres', label: 'Managed Postgres (default)' },
  { value: 'external_s3', label: 'External S3 bucket' },
];

const ENTRY_PREVIEW_DEFAULT = 50;
const ENTRY_PREVIEW_STEP = 50;
const ENTRY_PREVIEW_MAX = 200;

type TypeFilter = 'all' | KnowledgeSourceType;

type UploadFormState = {
  personas: string[];
  shareWithHq: boolean;
  retentionPolicy: KnowledgeRetentionPolicy;
  storageStrategy: KnowledgeStorageStrategy;
  metadataText: string;
};

type NoteFormState = {
  personas: string[];
  tagsText: string;
  shareWithHq: boolean;
  retentionPolicy: KnowledgeRetentionPolicy;
  metadataText: string;
};

function createInitialUploadState(): UploadFormState {
  return {
    personas: [],
    shareWithHq: false,
    retentionPolicy: 'retain_indefinitely',
    storageStrategy: 'managed_postgres',
    metadataText: '',
  };
}

function createInitialNoteState(): NoteFormState {
  return {
    personas: [],
    tagsText: '',
    shareWithHq: false,
    retentionPolicy: 'retain_indefinitely',
    metadataText: '',
  };
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unexpected file reader result'));
        return;
      }
      const [, base64] = reader.result.split('base64,');
      resolve(base64 ?? reader.result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item): item is string => item.length > 0);
}

export default function KnowledgePage() {
  const { getToken } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState<boolean>(true);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [sources, setSources] = useState<KnowledgeSourceSummary[]>([]);
  const [totals, setTotals] = useState<KnowledgeSourceListResponse['totals']>({
    sources: 0,
    entries: 0,
    tokens: 0,
  });
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<KnowledgeSourceSummary | null>(null);
  const [entryPreviews, setEntryPreviews] = useState<KnowledgeEntryPreview[]>([]);
  const [entryPreviewLimit, setEntryPreviewLimit] = useState<number>(ENTRY_PREVIEW_DEFAULT);

  const selectedSourceIdRef = useRef<string | null>(null);
  const detailCardRef = useRef<HTMLDivElement | null>(null);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  const [personaFilter, setPersonaFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchPersona, setSearchPersona] = useState<string>('all');
  const [limitToSelected, setLimitToSelected] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [searchAttempted, setSearchAttempted] = useState<boolean>(false);

  const [uploadOpen, setUploadOpen] = useState<boolean>(false);
  const [noteOpen, setNoteOpen] = useState<boolean>(false);

  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadFormState>(createInitialUploadState);
  const [noteState, setNoteState] = useState<NoteFormState>(createInitialNoteState);
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [noteContent, setNoteContent] = useState<string>('');

  const [uploading, setUploading] = useState<boolean>(false);
  const [creatingNote, setCreatingNote] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    selectedSourceIdRef.current = selectedSourceId;
    if (!selectedSourceId) {
      setLimitToSelected(false);
      setHighlightEntryId(null);
      setEntryPreviewLimit(ENTRY_PREVIEW_DEFAULT);
    }
  }, [selectedSourceId]);

  useEffect(() => {
    if (!uploadOpen) {
      setFile(null);
      setUploadState(createInitialUploadState());
    }
  }, [uploadOpen]);

  useEffect(() => {
    if (!noteOpen) {
      setNoteTitle('');
      setNoteContent('');
      setNoteState(createInitialNoteState());
    }
  }, [noteOpen]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchAttempted(false);
      setSearchResults([]);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (!highlightEntryId) {
      return;
    }
    const container = detailCardRef.current;
    if (!container) {
      return;
    }
    const target = container.querySelector<HTMLElement>(
      `[data-entry-id="${highlightEntryId}"]`
    );
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightEntryId, entryPreviews]);

  const loadSourceDetail = useCallback(
    async (sourceId: string, options?: { highlightEntryId?: string; limit?: number }) => {
      setDetailLoading(true);
      try {
        const api = createApiClient(getToken);
        const requestedLimit = options?.limit ?? entryPreviewLimit;
        const constrainedLimit = Math.min(
          Math.max(requestedLimit, ENTRY_PREVIEW_DEFAULT),
          ENTRY_PREVIEW_MAX
        );

        let resolvedLimit = constrainedLimit;
        let response = await api.getKnowledgeSource(sourceId, {
          limit: resolvedLimit,
        });

        let highlightFound = options?.highlightEntryId
          ? response.entries.some((entry) => entry.id === options.highlightEntryId)
          : false;

        if (options?.highlightEntryId && !highlightFound && resolvedLimit < ENTRY_PREVIEW_MAX) {
          resolvedLimit = ENTRY_PREVIEW_MAX;
          response = await api.getKnowledgeSource(sourceId, {
            limit: resolvedLimit,
          });
          highlightFound = response.entries.some((entry) => entry.id === options.highlightEntryId);
        }

        if (options?.highlightEntryId && !highlightFound) {
          toast({
            title: 'Entry not in preview',
            description:
              'The selected chunk was not included in the recent preview window. Export the source to review the full history.',
          });
        }

        if (resolvedLimit !== entryPreviewLimit) {
          setEntryPreviewLimit(resolvedLimit);
        }

        setSelectedSourceId(sourceId);
        selectedSourceIdRef.current = sourceId;
        setSelectedSource(response.source);
        setEntryPreviews(response.entries);
        setHighlightEntryId(highlightFound ? options?.highlightEntryId ?? null : null);
      } catch (error) {
        console.error('Failed to load knowledge source detail', error);
        toast({
          title: 'Unable to open source',
          description: 'We could not load the selected knowledge source.',
          variant: 'destructive',
        });
        setSelectedSourceId(null);
        selectedSourceIdRef.current = null;
        setSelectedSource(null);
        setEntryPreviews([]);
        setHighlightEntryId(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [entryPreviewLimit, getToken, toast]
  );

  const loadSources = useCallback(
    async (focusId?: string) => {
      setLoading(true);
      try {
        const api = createApiClient(getToken);
        const response = await api.getKnowledgeSources();
        setSources(response.sources);
        setTotals(response.totals);

        const nextSelected = focusId ?? selectedSourceIdRef.current;
        if (nextSelected) {
          const exists = response.sources.find((source) => source.id === nextSelected);
          if (exists) {
            await loadSourceDetail(nextSelected);
          } else {
            setSelectedSourceId(null);
            selectedSourceIdRef.current = null;
            setSelectedSource(null);
            setEntryPreviews([]);
            setHighlightEntryId(null);
          }
        }
      } catch (error) {
        console.error('Failed to load knowledge sources', error);
        toast({
          title: 'Failed to load knowledge',
          description: 'Please refresh the page or try again shortly.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    },
    [getToken, loadSourceDetail, toast]
  );

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const handleSearch = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      if (event) {
        event.preventDefault();
      }

      const trimmed = searchQuery.trim();
      if (!trimmed) {
        toast({
          title: 'Add a search query',
          description: 'Enter a few keywords to search your knowledge base.',
          variant: 'destructive',
        });
        return;
      }

      setHighlightEntryId(null);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
      setCopyingId(null);
      setSearching(true);
      setSearchResults([]);

      try {
        const api = createApiClient(getToken);
        const persona = searchPersona !== 'all' ? searchPersona : undefined;
        const sourceIds =
          limitToSelected && selectedSourceIdRef.current
            ? [selectedSourceIdRef.current]
            : undefined;

        const results = await api.searchKnowledge({
          query: trimmed,
          persona,
          sourceIds,
          limit: 12,
        });

        setSearchResults(results);
        setSearchAttempted(true);
      } catch (error) {
        console.error('Knowledge search failed', error);
        toast({
          title: 'Search failed',
          description: 'We could not complete the knowledge search. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setSearching(false);
      }
    },
    [getToken, limitToSelected, searchPersona, searchQuery, toast]
  );

  const handleCopyResult = useCallback(
    async (result: KnowledgeSearchResult) => {
      try {
        if (copyTimeoutRef.current !== null) {
          window.clearTimeout(copyTimeoutRef.current);
        }

        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(result.content);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = result.content;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }

        setCopyingId(result.entry.id);
        toast({
          title: 'Snippet copied',
          description: 'The knowledge chunk is ready to paste.',
        });

        copyTimeoutRef.current = window.setTimeout(() => {
          setCopyingId(null);
          copyTimeoutRef.current = null;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy snippet', error);
        toast({
          title: 'Copy failed',
          description: 'We could not copy the snippet to your clipboard.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  const handleOpenSearchResult = useCallback(
    async (result: KnowledgeSearchResult) => {
      if (!result.entry.sourceId) {
        toast({
          title: 'Source unavailable',
          description: 'We could not determine which source created this chunk.',
          variant: 'destructive',
        });
        return;
      }

      const desiredLimit = entryPreviewLimit < ENTRY_PREVIEW_MAX ? ENTRY_PREVIEW_MAX : entryPreviewLimit;

      await loadSourceDetail(result.entry.sourceId, {
        highlightEntryId: result.entry.id,
        limit: desiredLimit,
      });
      setLimitToSelected(true);
      detailCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [entryPreviewLimit, loadSourceDetail, toast]
  );

  const handleLoadMoreEntries = useCallback(() => {
    const currentSourceId = selectedSourceIdRef.current;
    if (!currentSourceId) {
      return;
    }

    const nextLimit = Math.min(entryPreviewLimit + ENTRY_PREVIEW_STEP, ENTRY_PREVIEW_MAX);
    void loadSourceDetail(currentSourceId, {
      limit: nextLimit,
      highlightEntryId: highlightEntryId ?? undefined,
    });
  }, [entryPreviewLimit, highlightEntryId, loadSourceDetail]);

  const handleResetEntryLimit = useCallback(() => {
    const currentSourceId = selectedSourceIdRef.current;
    if (!currentSourceId) {
      return;
    }

    void loadSourceDetail(currentSourceId, {
      limit: ENTRY_PREVIEW_DEFAULT,
      highlightEntryId: highlightEntryId ?? undefined,
    });
  }, [highlightEntryId, loadSourceDetail]);

  const personaOptions = useMemo(() => {
    const values = new Set<string>();
    sources.forEach((source) => {
      source.stats.personas.forEach((persona) => values.add(persona));
    });
    return Array.from(values).sort();
  }, [sources]);

  const personaFilterOptions = useMemo(() => {
    if (personaOptions.length > 0) {
      return personaOptions;
    }
    return PERSONA_OPTIONS.map((option) => option.value);
  }, [personaOptions]);

  const typeOptions = useMemo(() => {
    const values = new Set<KnowledgeSourceType>();
    sources.forEach((source) => values.add(source.type));
    return Array.from(values).sort();
  }, [sources]);

  const filteredSources = useMemo(() => {
    return sources.filter((source) => {
      const matchesType = typeFilter === 'all' || source.type === typeFilter;
      const matchesPersona =
        personaFilter === 'all' || source.stats.personas.includes(personaFilter);
      return matchesType && matchesPersona;
    });
  }, [sources, personaFilter, typeFilter]);

  const parseMetadata = (input: string): Record<string, unknown> | undefined => {
    if (!input.trim()) {
      return undefined;
    }
    try {
      return JSON.parse(input) as Record<string, unknown>;
    } catch (error) {
      throw new Error('Metadata must be valid JSON');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast({
        title: 'Select a file',
        description: 'Please pick a document to upload.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    try {
      const metadata = parseMetadata(uploadState.metadataText);
      const base64 = await fileToBase64(file);
      const payload: KnowledgeUploadPayload = {
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        content: base64,
        personas: uploadState.personas,
        shareWithHq: uploadState.shareWithHq,
        retentionPolicy: uploadState.retentionPolicy,
        storageStrategy: uploadState.storageStrategy,
        metadata,
      };

      const api = createApiClient(getToken);
      const summary: KnowledgeIngestionSummary = await api.uploadKnowledgeDocument(payload);

      toast({
        title: 'Upload complete',
        description: `${summary.chunkCount} chunks indexed from ${summary.sourceName}.`,
      });

      setUploadOpen(false);
      await loadSources(summary.sourceId);
    } catch (error) {
      console.error('Upload failed', error);
      toast({
        title: 'Upload failed',
        description:
          error instanceof Error ? error.message : 'Unable to upload document. Please retry.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleCreateNote = async () => {
    if (!noteTitle.trim() || !noteContent.trim()) {
      toast({
        title: 'Add note details',
        description: 'Title and content are required for manual notes.',
        variant: 'destructive',
      });
      return;
    }

    setCreatingNote(true);
    try {
      const metadata = parseMetadata(noteState.metadataText);
      const payload: KnowledgeNotePayload = {
        title: noteTitle.trim(),
        content: noteContent.trim(),
        personas: noteState.personas,
        tags: noteState.tagsText
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
        shareWithHq: noteState.shareWithHq,
        retentionPolicy: noteState.retentionPolicy,
        metadata,
      };

      const api = createApiClient(getToken);
      const summary = await api.createKnowledgeNote(payload);

      toast({
        title: 'Manual note saved',
        description: `${summary.chunkCount} segments indexed from ${summary.sourceName}.`,
      });

      setNoteOpen(false);
      await loadSources(summary.sourceId);
    } catch (error) {
      console.error('Manual note failed', error);
      toast({
        title: 'Unable to save note',
        description:
          error instanceof Error
            ? error.message
            : 'Something went wrong saving your note.',
        variant: 'destructive',
      });
    } finally {
      setCreatingNote(false);
    }
  };

  const handleDelete = async (sourceId: string, sourceName: string) => {
    if (!window.confirm(`Delete knowledge source "${sourceName}"? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      const api = createApiClient(getToken);
      await api.deleteKnowledgeSource(sourceId);
      toast({
        title: 'Knowledge deleted',
        description: `${sourceName} has been removed from your knowledge base.`,
      });
      const currentSelected = selectedSourceIdRef.current;
      const removedSelected = currentSelected === sourceId;
      await loadSources(removedSelected ? undefined : currentSelected ?? undefined);
      if (removedSelected) {
        setSelectedSourceId(null);
        selectedSourceIdRef.current = null;
        setSelectedSource(null);
        setEntryPreviews([]);
      }
    } catch (error) {
      console.error('Failed to delete knowledge source', error);
      toast({
        title: 'Unable to delete source',
        description: 'Please try again or contact support for assistance.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async (sourceId: string, sourceName: string) => {
    setExporting(true);
    try {
      const api = createApiClient(getToken);
      const blob = await api.exportKnowledgeSource(sourceId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sourceName.replace(/\s+/g, '-').toLowerCase()}-knowledge.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export knowledge', error);
      toast({
        title: 'Export failed',
        description: 'We could not generate the export archive. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Knowledge Management</h1>
          <p className="text-muted-foreground">
            Upload documents, capture notes, and control which personas can access them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <FileText className="mr-2 h-4 w-4" />
                New Manual Note
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add manual knowledge note</DialogTitle>
                <DialogDescription>
                  Capture quick insights, announcements, or tribal knowledge directly in the knowledge base.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    placeholder="Finance team weekly update"
                    value={noteTitle}
                    onChange={(event) => setNoteTitle(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Content</label>
                  <textarea
                    className="min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder="Summarize the key points to make them easy to reference later..."
                    value={noteContent}
                    onChange={(event) => setNoteContent(event.target.value)}
                  />
                </div>
                <PersonaSelector
                  label="Personas"
                  selected={noteState.personas}
                  onChange={(next) =>
                    setNoteState((prev) => ({
                      ...prev,
                      personas: next,
                    }))
                  }
                />
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Tags (comma separated)</label>
                  <Input
                    placeholder="compliance, finance, q4"
                    value={noteState.tagsText}
                    onChange={(event) =>
                      setNoteState((prev) => ({
                        ...prev,
                        tagsText: event.target.value,
                      }))
                    }
                  />
                </div>
                <RetentionControls
                  state={noteState}
                  onUpdate={setNoteState}
                />
                <MetadataField
                  value={noteState.metadataText}
                  onChange={(value) =>
                    setNoteState((prev) => ({
                      ...prev,
                      metadataText: value,
                    }))
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setNoteOpen(false)}
                  disabled={creatingNote}
                >
                  Cancel
                </Button>
                <Button onClick={() => void handleCreateNote()} disabled={creatingNote}>
                  {creatingNote ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Save note
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button>
                <Upload className="mr-2 h-4 w-4" />
                Upload Document
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Upload knowledge document</DialogTitle>
                <DialogDescription>
                  PDFs, DOCX, Markdown, and JSON files are supported. Files are chunked, embedded, and encrypted automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">File</label>
                  <Input
                    type="file"
                    accept=".pdf,.docx,.md,.markdown,.json,.txt"
                    onChange={(event) => {
                      const [selected] = Array.from(event.target.files ?? []);
                      setFile(selected ?? null);
                    }}
                  />
                  {file && (
                    <p className="text-xs text-muted-foreground">
                      {file.name} • {(file.size / 1024).toFixed(1)} KB
                    </p>
                  )}
                </div>
                <PersonaSelector
                  label="Personas"
                  selected={uploadState.personas}
                  onChange={(next) =>
                    setUploadState((prev) => ({
                      ...prev,
                      personas: next,
                    }))
                  }
                />
                <RetentionControls
                  state={uploadState}
                  onUpdate={setUploadState}
                />
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Storage strategy</label>
                  <Select
                    value={uploadState.storageStrategy}
                    onValueChange={(value: KnowledgeStorageStrategy) =>
                      setUploadState((prev) => ({
                        ...prev,
                        storageStrategy: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STORAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <MetadataField
                  value={uploadState.metadataText}
                  onChange={(value) =>
                    setUploadState((prev) => ({
                      ...prev,
                      metadataText: value,
                    }))
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setUploadOpen(false)}
                  disabled={uploading}
                >
                  Cancel
                </Button>
                <Button onClick={() => void handleUpload()} disabled={uploading}>
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Upload
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Sources" value={totals.sources} icon={Upload} />
        <MetricCard title="Entries" value={totals.entries.toLocaleString()} icon={FileText} />
        <MetricCard
          title="Tokens"
          value={totals.tokens.toLocaleString()}
          icon={ArrowUpRight}
        />
        <MetricCard
          title="Persona coverage"
          value={`${personaOptions.length} personas`}
          icon={Users}
        />
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-col gap-1">
            <CardTitle>Search knowledge</CardTitle>
            <p className="text-sm text-muted-foreground">
              Find relevant chunks across uploads and notes. Narrow by persona or the currently selected source.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            className="grid gap-4"
            onSubmit={(event) => void handleSearch(event)}
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="grid gap-2">
                <label htmlFor="knowledge-search-query" className="text-sm font-medium">
                  Keywords
                </label>
                <Input
                  id="knowledge-search-query"
                  placeholder="Search across notes and uploads..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={searching || !searchQuery.trim()}
              >
                {searching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium">Persona</label>
                <Select value={searchPersona} onValueChange={(value) => setSearchPersona(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All personas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All personas</SelectItem>
                    {personaFilterOptions.map((persona) => (
                      <SelectItem key={persona} value={persona}>
                        {persona.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={limitToSelected}
                  disabled={!selectedSourceId}
                  onChange={(event) => setLimitToSelected(event.target.checked)}
                />
                Limit to selected source
              </label>
            </div>
          </form>

          <div className="space-y-3">
            {searchResults.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {searchResults.map((result) => {
                  const entry = result.entry;
                  const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
                  const personas = toStringArray(metadata['personas']);
                  const tags = toStringArray(metadata['tags']);
                  const documentTitle =
                    typeof metadata['documentTitle'] === 'string'
                      ? (metadata['documentTitle'] as string)
                      : undefined;
                  const updatedLabel = formatRelativeTime(entry.updatedAt);
                  const matchLabel = `${Math.round(result.score * 100)}% match`;
                  const isActive = highlightEntryId === entry.id;

                  return (
                    <div
                      key={entry.id}
                      className={`rounded-lg border p-4 shadow-sm transition ${
                        isActive ? 'border-primary bg-primary/5' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{entry.sourceName ?? 'Unknown source'}</span>
                        <span>{matchLabel}</span>
                      </div>
                      {documentTitle && (
                        <div className="mt-2 text-sm font-semibold text-foreground">
                          {documentTitle}
                        </div>
                      )}
                      <p className="mt-3 text-sm leading-relaxed text-foreground">
                        {result.content}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{updatedLabel}</span>
                        <span>
                          {entry.tokenCount ? `${entry.tokenCount.toLocaleString()} tokens` : 'Token count n/a'}
                        </span>
                      </div>
                      {(personas.length > 0 || tags.length > 0) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {personas.map((persona) => (
                            <Badge key={`${entry.id}-${persona}`} variant="outline">
                              {persona.toUpperCase()}
                            </Badge>
                          ))}
                          {tags.map((tag) => (
                            <Badge key={`${entry.id}-tag-${tag}`} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {isActive && <Badge variant="default">Viewing</Badge>}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleCopyResult(result)}
                          className="flex items-center gap-2"
                        >
                          {copyingId === entry.id ? (
                            <Check className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          {copyingId === entry.id ? 'Copied' : 'Copy snippet'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                          onClick={() => void handleOpenSearchResult(result)}
                        >
                          View source
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : searchAttempted ? (
              <p className="text-sm text-muted-foreground">
                No knowledge matches found for “{searchQuery.trim()}”. Try different keywords or broaden your filters.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Run a search to preview the most relevant knowledge chunks.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>Knowledge sources</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={typeFilter}
              onValueChange={(value: string) => setTypeFilter(value as TypeFilter)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {typeOptions.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={personaFilter}
              onValueChange={(value) => setPersonaFilter(value)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by persona" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All personas</SelectItem>
                {personaFilterOptions.map((persona) => (
                  <SelectItem key={persona} value={persona}>
                    {persona.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p>No knowledge sources found.</p>
              <p className="text-sm">Upload a document or add a manual note to get started.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-left font-medium">Personas</th>
                    <th className="px-4 py-3 text-left font-medium">Entries</th>
                    <th className="px-4 py-3 text-left font-medium">Updated</th>
                    <th className="px-4 py-3 text-left font-medium">Retention</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredSources.map((source) => {
                    const isSelected = selectedSourceId === source.id;
                    return (
                      <tr
                        key={source.id}
                        className={`cursor-pointer transition hover:bg-muted/50 ${isSelected ? 'bg-muted/70' : ''}`}
                        onClick={() => void loadSourceDetail(source.id)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium">{source.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {source.provider} • {source.type.replace(/_/g, ' ')}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {source.stats.personas.length === 0 && (
                              <Badge variant="secondary">All personas</Badge>
                            )}
                            {source.stats.personas.map((persona) => (
                              <Badge key={persona} variant="outline">
                                {persona.toUpperCase()}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium">{source.stats.entryCount}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {source.stats.lastUpdatedAt
                            ? formatRelativeTime(source.stats.lastUpdatedAt)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {source.retentionPolicy.replace(/_/g, ' ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card ref={detailCardRef}>
        <CardHeader className="flex flex-col gap-4 border-b bg-muted/40 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Source details</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select a source to inspect metadata, personas, and recent chunks.
            </p>
          </div>
          {selectedSource && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExport(selectedSource.id, selectedSource.name)}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export ZIP
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  void handleDelete(selectedSource.id, selectedSource.name)
                }
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash className="mr-2 h-4 w-4" />
                )}
                Delete
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {detailLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !selectedSource ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p>Select a source to view its entries and metadata.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <h3 className="text-sm font-semibold uppercase text-muted-foreground">
                    Metadata
                  </h3>
                  <div className="mt-3 space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-foreground">Source ID:</span>
                      <span className="ml-2 text-muted-foreground">{selectedSource.id}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Provider:</span>
                      <span className="ml-2 text-muted-foreground">{selectedSource.provider}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Status:</span>
                      <span className="ml-2 text-muted-foreground">{selectedSource.status}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Retention:</span>
                      <span className="ml-2 text-muted-foreground">
                        {selectedSource.retentionPolicy.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Storage:</span>
                      <span className="ml-2 text-muted-foreground">
                        {selectedSource.storageStrategy.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {selectedSource.lastSyncedAt && (
                      <div>
                        <span className="font-medium text-foreground">Last synced:</span>
                        <span className="ml-2 text-muted-foreground">
                          {formatDateTime(selectedSource.lastSyncedAt)}
                        </span>
                      </div>
                    )}
                    {selectedSource.stats.tags.length > 0 && (
                      <div>
                        <span className="font-medium text-foreground">Tags:</span>
                        <span className="ml-2 text-muted-foreground">
                          {selectedSource.stats.tags.join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <h3 className="text-sm font-semibold uppercase text-muted-foreground">
                    Persona coverage
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedSource.stats.personas.length === 0 && (
                      <Badge variant="secondary">All personas</Badge>
                    )}
                    {selectedSource.stats.personas.map((persona) => (
                      <Badge key={persona} variant="outline">
                        {persona.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase text-muted-foreground">
                    Recent chunks ({entryPreviews.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Showing up to {entryPreviewLimit} entries</span>
                    <span className="text-muted-foreground/70">
                      Max {ENTRY_PREVIEW_MAX}
                    </span>
                  </div>
                </div>
                {entryPreviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No entries available yet for this source.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleLoadMoreEntries()}
                        disabled={entryPreviewLimit >= ENTRY_PREVIEW_MAX || detailLoading}
                      >
                        Load more
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetEntryLimit()}
                        disabled={entryPreviewLimit === ENTRY_PREVIEW_DEFAULT || detailLoading}
                      >
                        Reset
                      </Button>
                      {entryPreviewLimit >= ENTRY_PREVIEW_MAX && (
                        <span className="text-xs text-muted-foreground">
                          Maximum preview reached. Export to inspect the full history.
                        </span>
                      )}
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {entryPreviews.map((entry) => {
                        const personaLabel = entry.personas.length
                          ? entry.personas.map((persona) => persona.toUpperCase()).join(', ')
                          : 'All personas';
                        const isHighlighted = highlightEntryId === entry.id;
                        return (
                          <div
                            key={entry.id}
                            className={`rounded-lg border p-4 transition ${
                              isHighlighted ? 'border-primary bg-primary/5 shadow-sm' : ''
                            }`}
                            data-entry-id={entry.id}
                          >
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{formatRelativeTime(entry.createdAt)}</span>
                              <span>{personaLabel}</span>
                            </div>
                            <p className="mt-3 text-sm leading-relaxed text-foreground">
                              {entry.preview}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type PersonaSelectorProps = {
  label: string;
  selected: string[];
  onChange: (values: string[]) => void;
};

function PersonaSelector({ label, selected, onChange }: PersonaSelectorProps) {
  const known = new Set(PERSONA_OPTIONS.map((persona) => persona.value));
  const allOptions = [...PERSONA_OPTIONS];
  selected.forEach((value) => {
    if (!known.has(value)) {
      allOptions.push({ value, label: value.toUpperCase() });
      known.add(value);
    }
  });

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {allOptions.map((persona) => {
          const isChecked = selected.includes(persona.value);
          return (
            <button
              key={persona.value}
              type="button"
              className={`rounded-full border px-3 py-1 text-sm transition ${isChecked ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'}`}
              aria-pressed={isChecked}
              onClick={() => {
                const next = isChecked
                  ? selected.filter((value) => value !== persona.value)
                  : [...selected, persona.value];
                onChange(next);
              }}
            >
              {persona.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Leave empty to make the knowledge visible to all personas.
      </p>
    </div>
  );
}

type RetentionControlsProps<T extends { retentionPolicy: KnowledgeRetentionPolicy; shareWithHq: boolean }> = {
  state: T;
  onUpdate: Dispatch<SetStateAction<T>>;
};

function RetentionControls<T extends { retentionPolicy: KnowledgeRetentionPolicy; shareWithHq: boolean }>(
  { state, onUpdate }: RetentionControlsProps<T>
) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium">Retention policy</label>
      <Select
        value={state.retentionPolicy}
        onValueChange={(value: KnowledgeRetentionPolicy) =>
          onUpdate((prev) => ({
            ...prev,
            retentionPolicy: value,
          }))
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RETENTION_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.shareWithHq}
          onChange={(event) =>
            onUpdate((prev) => ({
              ...prev,
              shareWithHq: event.target.checked,
            }))
          }
        />
        Share with HQ knowledge (company-wide)
      </label>
    </div>
  );
}

type MetadataFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

function MetadataField({ value, onChange }: MetadataFieldProps) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium">Metadata (JSON, optional)</label>
      <textarea
        className="min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        placeholder='{"documentId":"ops-playbook","tags":["ops","playbook"]}'
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Metadata is encrypted at rest and made available when retrieving the context.
      </p>
    </div>
  );
}
