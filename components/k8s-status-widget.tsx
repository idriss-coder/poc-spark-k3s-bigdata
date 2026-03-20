"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, HardDrives, Cube, Clock } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface ClusterData {
  timestamp: string;
  nodes: {
    name: string;
    status: string;
    roles: string;
    age: string;
    version: string;
    internal_ip: string;
    metrics?: {
      cpu_mcores_used: number;
      cpu_mcores_total: number;
      cpu_percent: number;
      ram_bytes_used: number;
      ram_bytes_total: number;
      ram_percent: number;
    };
  }[];
  pods: {
    name: string;
    ready: string;
    status: string;
    restarts: string;
    age: string;
    ip: string;
    node: string;
  }[];
  summary: {
    nodes_total: number;
    nodes_ready: number;
    pods_total: number;
    pods_running: number;
    pods_pending: number;
    pods_failed: number;
    cpu_mcores_used?: number;
    cpu_mcores_total?: number;
    cpu_percent?: number;
    ram_bytes_used?: number;
    ram_bytes_total?: number;
    ram_percent?: number;
  };
}

const formatCores = (mcores?: number) => {
  const v = typeof mcores === "number" ? mcores : 0;
  return `${(v / 1000).toFixed(2)} cores`;
};

const formatBytes = (bytes?: number) => {
  const b = typeof bytes === "number" ? bytes : 0;
  const gb = b / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GiB`;
  const mb = b / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(0)} MiB`;
  const kb = b / 1024;
  if (kb >= 1) return `${kb.toFixed(0)} KiB`;
  return `${b.toFixed(0)} B`;
};

function UsageBar({
  label,
  usedLabel,
  totalLabel,
  percent,
}: {
  label: string;
  usedLabel: string;
  totalLabel: string;
  percent: number;
}) {
  const p = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const isMuted = totalLabel === "—";
  return (
    <div className={cn("space-y-1", isMuted && "opacity-60")}>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span className="font-medium tracking-wide uppercase">{label}</span>
        <span className="tabular-nums">{p.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#326CE5]"
          style={{ width: `${p}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-600 tabular-nums">
        <span>{usedLabel}</span>
        <span className="text-slate-500">/ {totalLabel}</span>
      </div>
    </div>
  );
}

const K8sIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 120 120"
    className={className}
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M59.998 0L24.364 20.573L10.748 58.74L24.364 96.907L59.998 117.48L95.631 96.907L109.248 58.74L95.631 20.573L59.998 0ZM91.493 91.545L61.764 108.705V74.385H61.737H58.261V108.705L28.506 91.545L43.371 65.836C43.371 65.836 41.527 64.918 39.816 64.918C37.893 64.918 35.857 66.082 35.857 66.082L20.993 91.791L9.623 58.74L20.993 25.688L35.857 51.398C35.857 51.398 37.893 52.563 39.816 52.563C41.527 52.563 43.371 51.644 43.371 51.644L28.506 25.935L58.261 8.775V43.095H61.737V8.775L91.493 25.935L76.628 51.644C76.628 51.644 78.473 52.563 80.183 52.563C82.106 52.563 84.143 51.398 84.143 51.398L99.006 25.688L110.377 58.74L99.006 91.791L84.143 66.082C84.143 66.082 82.106 64.918 80.183 64.918C78.473 64.918 76.628 65.836 76.628 65.836L91.493 91.545Z" />
    <path d="M59.999 71.916C67.2766 71.916 73.176 66.0166 73.176 58.739C73.176 51.4614 67.2766 45.562 59.999 45.562C52.7214 45.562 46.822 51.4614 46.822 58.739C46.822 66.0166 52.7214 71.916 59.999 71.916Z" />
  </svg>
);

export function K8sStatusWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<ClusterData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/cluster`);
      if (!res.ok) throw new Error("Failed to fetch cluster data");
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isOpen) {
      fetchData();
      interval = setInterval(fetchData, 3000); // Poll every 3 seconds while open
    }
    return () => clearInterval(interval);
  }, [isOpen]);

  // Derived styling for pod status
  const getPodStatusColor = (status: string, readyStr: string) => {
    if (status === "Running" && readyStr.startsWith("1/")) return "bg-green-500/10 text-green-700 border-green-200";
    if (status === "Completed") return "bg-blue-500/10 text-blue-700 border-blue-200";
    if (status === "Pending" || status === "ContainerCreating") return "bg-amber-500/10 text-amber-700 border-amber-200";
    if (status.includes("Error") || status.includes("CrashLoop")) return "bg-red-500/10 text-red-700 border-red-200";
    return "bg-slate-500/10 text-slate-700 border-slate-200";
  };

  const sparkPods = data?.pods?.filter(p => !p.name.includes("kube-system")) || [];
  

  return (
    <>
      {/* Floating Button */}
      <motion.button
        onClick={() => setIsOpen(true)}
        className="fixed top-6 right-6 z-50 flex items-center justify-center w-12 h-12 bg-white text-[#326CE5] rounded-full  border border-slate-200  transition-all focus:outline-none focus:ring-2 focus:ring-[#326CE5]/50 group"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <K8sIcon className="w-7 h-7" />
      </motion.button>

      {/* Modal / Slide-over Panel (AWS Style) */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50"
            />

            {/* Panel */}
            <motion.div
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed top-0 right-0 h-full w-full sm:w-[500px] md:w-[600px] bg-[#f8f9fa]  z-50 flex flex-col border-l border-slate-200 font-sans"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 bg-[#232f3e] text-white border-b border-slate-700">
                <div className="flex items-center gap-3">
                  <K8sIcon className="w-8 h-8 text-[#326CE5]" />
                  <div>
                    <h2 className="text-lg font-semibold leading-tight tracking-wide">Cluster Status Explorer</h2>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {/* {loading ? (
                    <ArrowsClockwise className="w-5 h-5 animate-spin text-slate-300" />
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-slate-300 mr-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      Polling Live
                    </div>
                  )} */}
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 hover:bg-white/10 rounded-md transition-colors"
                  >
                    <X className="w-5 h-5 text-slate-300" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {error && (
                  <div className="p-4 bg-red-50 text-red-700 text-sm border border-red-200 rounded-md">
                    Error connecting to cluster API: {error}
                  </div>
                )}

                {/* Global CPU/RAM */}
                <section className="bg-white border border-slate-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-semibold text-slate-800">Cluster Utilization</div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : ""}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <UsageBar
                      label="CPU"
                      usedLabel={formatCores(data?.summary?.cpu_mcores_used)}
                      totalLabel={
                        typeof data?.summary?.cpu_mcores_total === "number" && data.summary.cpu_mcores_total > 0
                          ? formatCores(data.summary.cpu_mcores_total)
                          : "—"
                      }
                      percent={Number(data?.summary?.cpu_percent ?? 0)}
                    />
                    <UsageBar
                      label="Memory"
                      usedLabel={formatBytes(data?.summary?.ram_bytes_used)}
                      totalLabel={
                        typeof data?.summary?.ram_bytes_total === "number" && data.summary.ram_bytes_total > 0
                          ? formatBytes(data.summary.ram_bytes_total)
                          : "—"
                      }
                      percent={Number(data?.summary?.ram_percent ?? 0)}
                    />
                  </div>
                </section>

                {/* Pods Section (More Prominent!) */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Cube className="w-5 h-5 text-[#326CE5]" />
                      Spark & Application Pods
                    </h3>
                    <Badge className="bg-primary hover:bg-[#326CE5] text-white">Live Scaling</Badge>
                  </div>

                  <div className="space-y-4">

                    {/* Spark Executors / Drivers */}
                    <div className="space-y-2">
                      {sparkPods.length === 0 && (
                        <div className="p-4 border border-dashed border-slate-300 rounded-lg text-center bg-slate-50">
                          <p className="text-sm text-slate-500">No active Spark workloads.</p>
                          <p className="text-xs text-slate-400 mt-1">Submit a job to see dynamic scaling in action.</p>
                        </div>
                      )}
                      {sparkPods.filter(p=>p.status.toLowerCase()!=="completed").map((pod) => (
                        <Card key={pod.ready} className={cn("p-3 border-l-4  transition-all", pod.restarts === "Running" ? "border-l-primary" : "border-l-amber-500")}>
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-mono text-sm font-semibold text-slate-900 break-all">{pod.ready}</div>
                              <div className="flex gap-3 text-xs text-slate-500 mt-1">
                                <span>Ready: {pod.status}</span>
                                <span>Restarts: {pod.age}</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <Badge variant="outline" className={getPodStatusColor(pod.restarts, pod.status)}>
                                {pod.restarts}
                              </Badge>
                              <span className="text-[10px] text-slate-400 font-medium">Age: {pod.ip}</span>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>


                  </div>
                </section>

                <hr className="border-slate-200" />

                {/* Nodes Section (Less Prominent) */}
                <section className="opacity-60">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
                      <HardDrives className="w-4 h-4 text-slate-400" />
                      Worker Nodes ({data?.summary?.nodes_ready || 0}/{data?.summary?.nodes_total || 0})
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {data?.nodes?.map((node) => (
                      <div
                        key={node.name}
                        className="bg-white p-3 rounded-md border border-slate-200 text-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div className="font-medium text-slate-800 truncate max-w-[150px]" title={node.name}>
                            {node.name.split('.')[0]}
                          </div>
                          <Badge variant="outline" className={cn(
                            "text-[10px] px-1.5 py-0",
                            node.status === "Ready" ? "text-green-600 border-green-200" : "text-amber-600 border-amber-200"
                          )}>
                            {node.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-500 mt-2 flex justify-between">
                          <span>{node.roles}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {node.age}</span>
                        </div>

                        <div className="mt-3 space-y-3">
                          <UsageBar
                            label="CPU"
                            usedLabel={formatCores(node.metrics?.cpu_mcores_used)}
                            totalLabel={
                              typeof node.metrics?.cpu_mcores_total === "number" && node.metrics.cpu_mcores_total > 0
                                ? formatCores(node.metrics.cpu_mcores_total)
                                : "—"
                            }
                            percent={Number(node.metrics?.cpu_percent ?? 0)}
                          />
                          <UsageBar
                            label="Memory"
                            usedLabel={formatBytes(node.metrics?.ram_bytes_used)}
                            totalLabel={
                              typeof node.metrics?.ram_bytes_total === "number" && node.metrics.ram_bytes_total > 0
                                ? formatBytes(node.metrics.ram_bytes_total)
                                : "—"
                            }
                            percent={Number(node.metrics?.ram_percent ?? 0)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
