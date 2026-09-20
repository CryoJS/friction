import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isScanFinished,
  issuePath,
  SEVERITY_LABELS,
  type RunSnapshot,
  type ScanIssue,
  type ScanReportResponse,
  type ScanTreeResponse,
  type ScanTreeTask,
  type StepEvent,
} from "@friction/shared";
import { api } from "../../lib/api";
import { pathOf, shortUrl } from "../../lib/format";
import { annotationFindingIdForIssue } from "../../lib/scan";
import { categoryLabel } from "../badges";
import { Chip, Dot, SEVERITY_STYLES, SeverityIcon, stateTone } from "../badges";
import { EvidenceImage, type EvidenceSource } from "../EvidenceImage";
import { ChevronDown, ChevronRight, Cross } from "../icons";

interface Props {
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  onSelectNode: (nodeId: string) => void;
  onOpenIssue?: (taskId: string, issueKey: string) => void;
  onOpenAnnotation?: (findingId: string) => void;
  onSelectPath?: (path: string) => void;
  sidebar?: boolean;
}

interface DirectoryPath {
  key: string;
  label: string;
  title: string;
  kind: "page" | "panel";
  root: boolean;
  parentKey: string | null;
  parentInferred: boolean;
  preview: EvidenceSource | null;
  previewTimestamp: number;
}

interface DirectoryRow extends DirectoryPath {
  agents: ScanTreeTask[];
  issues: ScanIssue[];
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

interface DirectoryModel {
  rows: DirectoryRow[];
  total: number;
}

interface ExpandedPreview {
  source: EvidenceSource;
  label: string;
}

function pageKey(url: string): string {
  return issuePath(url) || "/";
}

function panelKey(path: string, label: string): string {
  return `panel:${path}:${label.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function panelLabel(path: string, label: string): string {
  return `${path} · ${label.trim()}`;
}

interface StepPreview {
  source: EvidenceSource;
  timestamp: number;
}

function stepPreview(step: StepEvent): StepPreview {
  return {
    timestamp: step.ts,
    source: { screenshotKey: step.payload.screenshotKey, bbox: null, viewport: step.payload.viewport, payload: step.payload },
  };
}

function recordSnapshotPaths(
  snapshot: RunSnapshot,
  rootPath: string,
  addPage: (url: string, parentKey: string, preview?: StepPreview | null) => string,
  addPanel: (basePath: string, label: string, preview?: StepPreview | null) => string,
): void {
  let currentPage = rootPath;
  let currentLocation = rootPath;
  for (const step of primarySteps(snapshot)) {
    const destination = pageKey(stepUrl(step));
    const preview = stepPreview(step);
    addPage(stepUrl(step), destination === currentPage ? destination : currentLocation, preview);
    currentPage = destination;
    currentLocation = destination;
    const panel = step.payload.signals?.modalAppeared && step.payload.signals.modalLabel?.trim();
    if (panel) currentLocation = addPanel(destination, panel, preview);
  }
}

function primarySteps(snapshot: RunSnapshot): StepEvent[] {
  return snapshot.events
    .filter((event): event is StepEvent => event.lane === "primary" && event.type === "step")
    .sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}

function stepUrl(step: StepEvent): string {
  return step.payload.signals?.urlAfter ?? step.payload.url;
}

function currentPath(snapshot: RunSnapshot | undefined, rootPath: string): string {
  if (!snapshot) return rootPath;
  let current = rootPath;
  for (const step of primarySteps(snapshot)) {
    current = pageKey(stepUrl(step));
    const panel = step.payload.signals?.modalAppeared && step.payload.signals.modalLabel?.trim();
    if (panel) current = panelKey(current, panel);
  }
  return current;
}

function useRunSnapshots(tasks: readonly ScanTreeTask[], enabled: boolean, live: boolean): Record<string, RunSnapshot> {
  const [snapshots, setSnapshots] = useState<Record<string, RunSnapshot>>({});
  const runIds = useMemo(() => tasks.map((task) => task.runId), [tasks]);
  const runKey = runIds.join("|");

  useEffect(() => {
    if (!enabled || runIds.length === 0) return;
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      const results = await Promise.allSettled(runIds.map((runId) => api.getSnapshot(runId)));
      if (cancelled) return;
      setSnapshots((previous) => {
        const next = Object.fromEntries(Object.entries(previous).filter(([runId]) => runIds.includes(runId))) as Record<string, RunSnapshot>;
        results.forEach((result, index) => {
          const runId = runIds[index];
          if (result.status === "fulfilled" && runId) next[runId] = result.value;
        });
        return next;
      });
    };

    void refresh();
    if (!live) return () => { cancelled = true; };
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, live, runKey]);

  return snapshots;
}

export function PathView({ tree, report, onSelectNode, onOpenIssue, onOpenAnnotation, onSelectPath, sidebar = false }: Props) {
  const live = !isScanFinished(tree.scan.status);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(new Set());
  const [expandedPreview, setExpandedPreview] = useState<ExpandedPreview | null>(null);
  const snapshots = useRunSnapshots(tree.tasks, true, live);
  const directory = useMemo(() => buildDirectory(tree, report, snapshots, collapsedPaths), [tree, report, snapshots, collapsedPaths]);
  const togglePath = useCallback((key: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!expandedPreview) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setExpandedPreview(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [expandedPreview]);

  const activeAgents = tree.tasks.filter((task) => task.state === "running").length;

  return (
    <div className={`path-view absolute inset-0 overflow-y-auto ${sidebar ? "px-2 pb-3 pt-2 sm:px-3" : "px-4 pb-6 pt-5 sm:px-6"}`}>
      <div className={sidebar ? "w-full" : "mx-auto w-full max-w-5xl"}>
        {!sidebar && <header className="mb-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-caption text-smoke">Web paths</p>
            <h2 className="mt-1 truncate font-heading text-heading-sm font-medium tracking-[-0.02em] text-white">Site directory</h2>
            <p className="mt-1 text-caption text-ash">
              {directory.total} {directory.total === 1 ? "path" : "paths"} · {tree.tasks.length} {tree.tasks.length === 1 ? "agent" : "agents"}
            </p>
          </div>
          <Chip tone={live ? "glow" : "good"}>{live ? `${activeAgents} active` : "Snapshot"}</Chip>
        </header>}

        <section aria-label="Web paths" className="path-directory overflow-hidden rounded-card border border-hairline/10 bg-white/4">
          <div className={`grid ${sidebar ? "grid-cols-[minmax(0,1fr)_56px]" : "grid-cols-[minmax(0,1fr)_auto_64px]"} items-center gap-2 border-b border-hairline/10 text-caption text-smoke ${sidebar ? "px-3 py-2 sm:grid-cols-[minmax(0,1fr)_64px] sm:px-3" : "px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_80px] sm:px-5"}`}>
            <span>Path</span>
            {!sidebar && <span className="text-right">Issues</span>}
            <span className="text-right">Preview</span>
          </div>

          <div role="list">
            {directory.rows.map((row) => (
              <PathRow
                key={row.key}
                row={row}
                onToggle={togglePath}
                onSelectNode={onSelectNode}
                onOpenIssue={onOpenIssue}
                onOpenAnnotation={onOpenAnnotation}
                onSelectPath={onSelectPath}
                sidebar={sidebar}
                onOpenPreview={(source, label) => setExpandedPreview({ source, label })}
              />
            ))}
          </div>
        </section>

        {directory.total === 1 && live && (
          <p className="mt-3 text-center text-caption text-smoke">New paths appear here as the agents discover them.</p>
        )}
      </div>

      {expandedPreview && (
        <PreviewDialog preview={expandedPreview} onClose={() => setExpandedPreview(null)} />
      )}
    </div>
  );
}

function buildDirectory(
  tree: ScanTreeResponse,
  report: ScanReportResponse | null,
  snapshots: Record<string, RunSnapshot>,
  collapsedPaths: ReadonlySet<string>,
): DirectoryModel {
  const rootPath = pageKey(tree.scan.url);
  const paths = new Map<string, DirectoryPath>();

  const addPage = (url: string, parentKey = rootPath, preview: StepPreview | null = null, parentInferred = false): string => {
    const key = pageKey(url);
    const existing = paths.get(key);
    if (existing) {
      if (existing.parentInferred && !parentInferred && parentKey !== key && paths.has(parentKey)) {
        existing.parentKey = parentKey;
        existing.parentInferred = false;
      }
      if (preview && preview.timestamp >= existing.previewTimestamp) {
        existing.preview = preview.source;
        existing.previewTimestamp = preview.timestamp;
      }
      return key;
    }
    const root = key === rootPath;
    paths.set(key, {
      key,
      label: root ? shortUrl(tree.scan.url) : pathOf(url),
      title: url,
      kind: "page",
      root,
      parentKey: root ? null : paths.has(parentKey) && parentKey !== key ? parentKey : rootPath,
      parentInferred: root ? false : parentInferred || !paths.has(parentKey) || parentKey === key,
      preview: preview?.source ?? null,
      previewTimestamp: preview?.timestamp ?? -1,
    });
    return key;
  };

  const addUnknownPage = (key: string): void => {
    if (paths.has(key)) return;
    paths.set(key, {
      key,
      label: key,
      title: key,
      kind: "page",
      root: key === rootPath,
      parentKey: key === rootPath ? null : rootPath,
      parentInferred: key !== rootPath,
      preview: null,
      previewTimestamp: -1,
    });
  };

  const addPanel = (basePath: string, label: string, preview: StepPreview | null = null): string => {
    const key = panelKey(basePath, label);
    const existing = paths.get(key);
    if (existing) {
      if (preview && preview.timestamp >= existing.previewTimestamp) {
        existing.preview = preview.source;
        existing.previewTimestamp = preview.timestamp;
      }
      return key;
    }
    const baseLabel = paths.get(basePath)?.label ?? basePath;
    paths.set(key, {
      key,
      label: panelLabel(baseLabel, label),
      title: label,
      kind: "panel",
      root: false,
      parentKey: basePath,
      parentInferred: false,
      preview: preview?.source ?? null,
      previewTimestamp: preview?.timestamp ?? -1,
    });
    return key;
  };

  addPage(tree.scan.url, rootPath);

  for (const task of tree.tasks) {
    const snapshot = snapshots[task.runId];
    if (!snapshot) continue;
    recordSnapshotPaths(snapshot, rootPath, addPage, addPanel);
  }

  // Crawl pages do not carry a source link in the scan contract. Keep them in
  // the directory as root children until an agent supplies a real parent path.
  tree.scan.pages.forEach((page) => addPage(page.url, rootPath, null, true));

  const issuesByPath = new Map<string, ScanIssue[]>();
  for (const issue of report?.issues ?? []) {
    const key = issue.page || rootPath;
    addUnknownPage(key);
    const path = paths.get(key);
    if (path && issue.evidence && issue.evidence.ts >= path.previewTimestamp) {
      path.preview = { screenshotKey: issue.evidence.screenshotKey, bbox: null, viewport: issue.evidence.viewport };
      path.previewTimestamp = issue.evidence.ts;
    }
    const issues = issuesByPath.get(key) ?? [];
    issues.push(issue);
    issuesByPath.set(key, issues);
  }

  const agentsByPath = new Map<string, ScanTreeTask[]>();
  for (const task of tree.tasks) {
    const key = currentPath(snapshots[task.runId], rootPath);
    const agents = agentsByPath.get(key) ?? [];
    agents.push(task);
    agentsByPath.set(key, agents);
  }

  return {
    rows: flattenDirectory(paths, rootPath, collapsedPaths).map((path) => ({
      ...path,
      agents: agentsByPath.get(path.key) ?? [],
      issues: issuesByPath.get(path.key) ?? [],
    })),
    total: paths.size,
  };
}

function flattenDirectory(paths: Map<string, DirectoryPath>, rootPath: string, collapsedPaths: ReadonlySet<string>): Array<DirectoryPath & { depth: number; hasChildren: boolean; collapsed: boolean }> {
  const children = new Map<string, DirectoryPath[]>();
  for (const path of paths.values()) {
    if (path.key === rootPath) continue;
    const parentKey = path.parentKey && paths.has(path.parentKey) ? path.parentKey : rootPath;
    const siblings = children.get(parentKey) ?? [];
    siblings.push(path);
    children.set(parentKey, siblings);
  }

  const ordered: Array<DirectoryPath & { depth: number; hasChildren: boolean; collapsed: boolean }> = [];
  const expandable = new Set(children.keys());
  const visited = new Set<string>();
  const visit = (path: DirectoryPath, depth: number, hidden = false): void => {
    if (visited.has(path.key)) return;
    visited.add(path.key);
    const hasChildren = expandable.has(path.key);
    const collapsed = hasChildren && collapsedPaths.has(path.key);
    if (!hidden) ordered.push({ ...path, depth, hasChildren, collapsed });
    for (const child of children.get(path.key) ?? []) visit(child, depth + 1, hidden || collapsed);
  };

  const root = paths.get(rootPath);
  if (root) visit(root, 0);
  for (const path of paths.values()) {
    if (!visited.has(path.key)) visit(path, 0);
  }
  return ordered;
}

function PathRow({ row, onToggle, onSelectNode, onOpenIssue, onOpenAnnotation, onSelectPath, sidebar, onOpenPreview }: { row: DirectoryRow; onToggle: (key: string) => void; onSelectNode: (nodeId: string) => void; onOpenIssue?: Props["onOpenIssue"]; onOpenAnnotation?: Props["onOpenAnnotation"]; onSelectPath?: Props["onSelectPath"]; sidebar: boolean; onOpenPreview: (source: EvidenceSource, label: string) => void }) {
  return (
    <div
      role="listitem"
      style={{ paddingLeft: `${sidebar ? 12 + row.depth * 16 : 20 + row.depth * 24}px` }}
      className={`path-directory-row grid ${sidebar ? "min-h-0 grid-cols-[minmax(0,1fr)_56px] gap-2 py-2 pr-3" : "min-h-16 grid-cols-[minmax(0,1fr)_auto_64px] gap-3 py-3 pr-4"} items-center border-b border-hairline/10 transition-colors last:border-b-0 hover:bg-white/4 ${sidebar ? "sm:grid-cols-[minmax(0,1fr)_64px] sm:pr-3" : "sm:grid-cols-[minmax(0,1fr)_auto_80px] sm:pr-5"}`}
    >
      <div className={`flex min-w-0 ${sidebar ? "flex-col items-start gap-1" : "items-center gap-3"}`}>
        <button
          type="button"
          disabled={!row.hasChildren && !onSelectPath}
          aria-expanded={row.hasChildren ? !row.collapsed : undefined}
          aria-label={row.hasChildren ? `${row.collapsed ? "Expand" : "Collapse"} ${row.label}` : onSelectPath ? `Open ${row.label}` : row.label}
          onClick={() => {
            if (row.hasChildren) onToggle(row.key);
            onSelectPath?.(row.key);
          }}
          className={`flex min-w-0 items-center gap-2 text-left text-smoke transition-colors hover:text-white disabled:cursor-default disabled:hover:text-smoke ${sidebar ? "w-full" : ""}`}
        >
          {row.hasChildren ? row.collapsed ? <ChevronRight size={15} className="shrink-0" /> : <ChevronDown size={15} className="shrink-0" /> : <span aria-hidden="true" className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 max-w-full">
            <span className={`block truncate font-mono text-ui tracking-normal ${row.root ? "text-white" : "text-bone"}`} title={row.title}>
              {row.label}
            </span>
            {!sidebar && (row.root ? <span className="mt-0.5 block text-caption text-smoke">Starting path</span> : row.kind === "panel" ? <span className="mt-0.5 block text-caption text-smoke">Panel</span> : null)}
          </span>
        </button>

        {!sidebar && <div className="flex shrink-0 flex-wrap justify-start gap-1.5" aria-label={`${row.agents.length} agents on this path`}>
          {row.agents.map((task) => <AgentMarker key={task.runId} task={task} onSelectNode={onSelectNode} />)}
        </div>}

        {sidebar && row.issues.length > 0 && (
          <div className="ml-6 flex flex-wrap items-center gap-1" aria-label={`${row.issues.length} issues on this path`}>
            {row.issues.map((issue) => <IssueMarker key={issue.key} issue={issue} compact onOpenIssue={onOpenIssue} onOpenAnnotation={onOpenAnnotation} />)}
          </div>
        )}
      </div>

      {!sidebar && <div className="flex min-w-7 justify-end gap-1.5" aria-label={`${row.issues.length} issues on this path`}>
        {row.issues.map((issue) => <IssueMarker key={issue.key} issue={issue} onOpenIssue={onOpenIssue} onOpenAnnotation={onOpenAnnotation} />)}
      </div>}

      <div className="flex justify-end">
        {row.preview ? (
          <button
            type="button"
            onClick={() => onOpenPreview(row.preview!, row.label)}
            className={`path-preview-trigger shrink-0 rounded-ui border border-hairline/10 ${sidebar ? "h-8 w-14 sm:h-9 sm:w-16" : "h-10 w-16 sm:h-12 sm:w-20"}`}
            aria-haspopup="dialog"
            aria-label={`Expand preview for ${row.label}`}
            title="Expand preview"
          >
            <EvidenceImage source={row.preview} label={row.label} className="h-full w-full rounded-ui" />
          </button>
        ) : (
          <div className={`flex shrink-0 items-center justify-center rounded-ui border border-dashed border-hairline/10 bg-graphite text-[10px] text-smoke ${sidebar ? "h-8 w-14 sm:h-9 sm:w-16" : "h-10 w-16 sm:h-12 sm:w-20"}`}>
            No preview
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewDialog({ preview, onClose }: { preview: ExpandedPreview; onClose: () => void }) {
  return (
    <div
      className="path-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="path-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="path-preview-title">
        <div className="path-preview-header">
          <div className="min-w-0">
            <p className="text-caption text-smoke">Preview</p>
            <h2 id="path-preview-title" className="mt-1 truncate font-mono text-ui font-medium tracking-normal text-white" title={preview.label}>
              {preview.label}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="path-preview-close" aria-label="Close preview">
            <Cross size={17} />
          </button>
        </div>

        <div className="path-preview-image">
          <EvidenceImage source={preview.source} label={preview.label} />
        </div>
      </section>
    </div>
  );
}

function AgentMarker({ task, onSelectNode }: { task: ScanTreeTask; onSelectNode: (nodeId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelectNode(`t${task.index}`)}
      className="path-agent inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline/15 px-2 text-caption text-bone transition-colors hover:border-hairline/60 hover:text-white"
      title={`${task.title} · ${task.state}`}
      aria-label={`Agent ${task.index + 1}: ${task.title}`}
    >
      <Dot tone={stateTone(task.state)} size={6} />
      <span className="font-mono tracking-normal">Agent {task.index + 1}</span>
    </button>
  );
}

function IssueMarker({ issue, compact = false, onOpenIssue, onOpenAnnotation }: { issue: ScanIssue; compact?: boolean; onOpenIssue?: Props["onOpenIssue"]; onOpenAnnotation?: Props["onOpenAnnotation"] }) {
  const style = SEVERITY_STYLES[issue.severity];
  const taskIndex = issue.taskIndexes[0];
  const findingId = annotationFindingIdForIssue(issue);
  const open = () => {
    if (onOpenIssue && taskIndex !== undefined) {
      onOpenIssue(`t${taskIndex}`, issue.key);
      return;
    }
    if (findingId && onOpenAnnotation) onOpenAnnotation(findingId);
  };
  return (
    <button
      type="button"
      onClick={open}
      className={`path-issue-marker inline-flex ${compact ? "h-5 w-5" : "h-7 w-7"} items-center justify-center rounded-full border ${style.ring} ${style.text} transition-colors hover:bg-white/8`}
      title={`${onOpenIssue ? "Open issue details" : "Open in annotations"}: ${SEVERITY_LABELS[issue.severity]} · ${categoryLabel(issue.category)}${issue.summary ? ` · ${issue.summary}` : ""}`}
      aria-label={`${onOpenIssue ? "Open" : "Open in annotations"} ${categoryLabel(issue.category)} issue`}
    >
      <SeverityIcon severity={issue.severity} size={compact ? 11 : 14} />
    </button>
  );
}
