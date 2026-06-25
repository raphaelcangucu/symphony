import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Database,
  Download,
  HardDrive,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { http } from "@/services/http";
import {
  backupDownloadUrl,
  backupStats,
  cleanupBackups,
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
  type BackupRecord,
  type BackupStatsCategory,
} from "@/services/backups";

function humanBytes(n: number): string {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function formatSince(iso: string | null, t: TFunction): string {
  const h = hoursSince(iso);
  if (h == null) return t("backup.freshness.never");
  if (h < 1) return t("backup.freshness.minutes", { count: Math.max(1, Math.round(h * 60)) });
  if (h < 48) return t("backup.freshness.hours", { count: Math.round(h) });
  return t("backup.freshness.days", { count: Math.round(h / 24) });
}

function freshnessBorderClass(iso: string | null): string {
  const h = hoursSince(iso);
  if (h == null) return "border-destructive/60";
  if (h < 24) return "border-emerald-500/50";
  if (h < 72) return "border-amber-500/50";
  return "border-destructive/60";
}

function statusBadgeVariant(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
    case "synced":
      return "default";
    case "creating":
    case "uploading":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

export function BackupPage() {
  const { t } = useTranslation();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [stats, setStats] = useState<BackupStatsCategory | null>(null);
  const [sourceDb, setSourceDb] = useState<{ path: string; sizeHuman: string; exists: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([listBackups({ category: "database" }), backupStats()]);
      setBackups(listRes.data);
      setStats(statsRes.categories.database ?? null);
      const source = statsRes.source_database;
      if (source?.path) {
        setSourceDb({
          path: source.path,
          sizeHuman: source.size_human ?? humanBytes(source.size_bytes ?? 0),
          exists: Boolean(source.exists),
        });
      } else {
        setSourceDb(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("backup.toasts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runCreate = async () => {
    setCreating(true);
    try {
      const res = await createBackup("database", { trigger: "manual" });
      if (res.success) {
        toast.success(res.message || t("backup.toasts.created"));
      } else {
        toast.error(res.message || t("backup.toasts.failed"));
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("backup.toasts.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const runCleanup = async () => {
    try {
      const res = await cleanupBackups();
      toast.success(res.message || t("backup.toasts.cleanupDone"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("backup.toasts.cleanupFailed"));
    }
  };

  const runRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const res = await restoreBackup(restoreTarget.id);
      if (res.success) {
        toast.success(res.message || t("backup.toasts.restored"));
        setRestoreTarget(null);
      } else {
        toast.error(res.message || t("backup.toasts.restoreFailed"));
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("backup.toasts.restoreFailed"));
    } finally {
      setRestoring(false);
    }
  };

  const runDelete = async (id: number) => {
    if (!window.confirm(t("backup.deleteConfirm", { id }))) return;
    try {
      await deleteBackup(id);
      toast.success(t("backup.toasts.removed"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("backup.toasts.deleteFailed"));
    }
  };

  const runDownload = async (id: number, filename: string) => {
    try {
      const response = await http.get(backupDownloadUrl(id), { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("backup.toasts.downloadFailed"));
    }
  };

  const latestIso = stats?.latest?.created_at ?? null;

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("backup.title")}</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {t("backup.subtitle")}
            {sourceDb ? (
              <span className="mt-1 block font-mono text-xs">
                {t("backup.source", {
                  path: sourceDb.path,
                  status: sourceDb.exists ? sourceDb.sizeHuman : t("backup.missing"),
                })}
              </span>
            ) : null}
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void refresh()} disabled={loading} className="self-start shrink-0 sm:self-auto">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card className={`max-w-md border-2 ${freshnessBorderClass(latestIso)}`}>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("backup.sqliteDatabase")}</CardTitle>
          <Database className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-2xl font-bold">{stats?.count ?? 0}</div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <HardDrive className="h-3 w-3" />
            {humanBytes(stats?.total_bytes ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("backup.lastBackup", { when: formatSince(latestIso, t) })}
          </div>
          <Button size="sm" className="w-full" disabled={creating} onClick={() => void runCreate()}>
            <RefreshCw className={`mr-2 h-3 w-3 ${creating ? "animate-spin" : ""}`} />
            {t("backup.createBackup")}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void runCreate()} disabled={creating}>
          {creating ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
          {t("backup.backupDatabase")}
        </Button>
        <Button variant="outline" onClick={() => void runCleanup()}>
          {t("backup.removeExpired")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
            {t("backup.loading")}
          </p>
        ) : backups.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t("backup.noBackups")}</p>
        ) : (
          <table className="min-w-[640px] w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="w-16 p-3">{t("backup.table.id")}</th>
                <th className="p-3">{t("backup.table.file")}</th>
                <th className="p-3">{t("backup.table.trigger")}</th>
                <th className="p-3">{t("backup.table.size")}</th>
                <th className="p-3">{t("backup.table.status")}</th>
                <th className="p-3">{t("backup.table.created")}</th>
                <th className="p-3 text-right">{t("backup.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-3 font-mono">{b.id}</td>
                  <td className="max-w-[200px] truncate p-3">{b.filename}</td>
                  <td className="p-3">{b.trigger ?? "—"}</td>
                  <td className="p-3">{b.size_human}</td>
                  <td className="p-3">
                    <Badge variant={statusBadgeVariant(b.status)}>{b.status}</Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {b.created_at ? new Date(b.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t("backup.download")}
                        onClick={() => void runDownload(b.id, b.filename)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title={t("backup.restore")} onClick={() => setRestoreTarget(b)}>
                        <Database className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        title={t("backup.delete")}
                        onClick={() => void runDelete(b.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={restoreTarget != null} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backup.restoreDialog.title")}</DialogTitle>
            <DialogDescription>{t("backup.restoreDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{t("backup.restoreDialog.warning")}</p>
            </div>
          </div>
          {restoreTarget ? (
            <p className="text-sm text-muted-foreground">
              {t("backup.restoreDialog.backupLine", { id: restoreTarget.id, filename: restoreTarget.filename })}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              {t("backup.restoreDialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void runRestore()} disabled={restoring}>
              {restoring ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {restoring ? t("backup.restoreDialog.restoring") : t("backup.restoreDialog.restore")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
