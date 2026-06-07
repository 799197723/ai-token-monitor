import { useState, useMemo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCombinedStats } from "./hooks/useCombinedStats";
import { useToday } from "./hooks/useToday";
import { getTotalTokens } from "./lib/format";
import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { I18nProvider, useI18n } from "./i18n/I18nContext";
import { PopoverShell } from "./components/PopoverShell";
import { Header } from "./components/Header";
import { TabBar } from "./components/TabBar";
import type { TabType } from "./components/TabBar";
import { TodaySummary } from "./components/TodaySummary";
import { DailyChart } from "./components/DailyChart";
import { Heatmap } from "./components/Heatmap";
import { ModelBreakdown } from "./components/ModelBreakdown";
import { PeriodTotals } from "./components/PeriodTotals";
import { CacheEfficiency } from "./components/CacheEfficiency";
import { ActivityGraph } from "./components/ActivityGraph";
import { SourceSelector } from "./components/SourceSelector";
import { SalaryComparator } from "./components/SalaryComparator";
import { UsageAlertBar } from "./components/UsageAlertBar";
import { AnalyticsSubTabs } from "./components/AnalyticsSubTabs";
import type { AnalyticsSubTab } from "./components/AnalyticsSubTabs";
import { ProjectBreakdown } from "./components/ProjectBreakdown";
import { ToolUsage } from "./components/ToolUsage";
import { ShellCommands } from "./components/ShellCommands";
import { AnalyticsSummary } from "./components/AnalyticsSummary";
import { ActivityBreakdown } from "./components/ActivityBreakdown";
import { useUpdater } from "./hooks/useUpdater";

function AnalyticsEmptyState({ message }: { message: string }) {
  return (
    <div style={{
      background: "var(--bg-card)",
      borderRadius: "var(--radius-lg)",
      padding: "32px 16px",
      boxShadow: "var(--shadow-card)",
      textAlign: "center",
      color: "var(--text-secondary)",
      fontSize: 12,
    }}>
      {message}
    </div>
  );
}

function AppContent() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        invoke("hide_window").catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const { prefs } = useSettings();
  const { stats, error, loading } = useCombinedStats({
    includeClaude: prefs.include_claude,
    includeCodex: prefs.include_codex,
    includeOpencode: prefs.include_opencode,
    includeKimi: prefs.include_kimi,
    includeGlm: prefs.include_glm,
    includeHermes: prefs.include_hermes,
  });
  const t = useI18n();
  const updater = useUpdater();
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [analyticsSubTab, setAnalyticsSubTab] = useState<AnalyticsSubTab>("usage");
  const todayStr = useToday();

  const { today, weekAvg } = useMemo(() => {
    if (!stats) return { today: null, weekAvg: 0 };

    const today = stats.daily.find((d) => d.date === todayStr) ?? null;

    const last7 = stats.daily
      .filter((d) => {
        const diff = (new Date(todayStr).getTime() - new Date(d.date).getTime()) / 86400000;
        return diff >= 1 && diff <= 7;
      })
      .map((d) => getTotalTokens(d.tokens));

    const weekAvg = last7.length > 0
      ? last7.reduce((a, b) => a + b, 0) / last7.length
      : 0;

    return { today, weekAvg };
  }, [stats, todayStr]);

  if (loading && !stats) {
    return (
      <PopoverShell>
        <Header updater={updater} />
        <SourceSelector />
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          color: "var(--text-secondary)",
          fontSize: 13,
          fontWeight: 600,
        }}>
          {t("app.loading")}
        </div>
      </PopoverShell>
    );
  }

  if (error || !stats) {
    return (
      <PopoverShell>
        <Header updater={updater} />
        <SourceSelector />
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 8,
          color: "var(--text-secondary)",
          fontSize: 12,
          fontWeight: 600,
          textAlign: "center",
          padding: 20,
        }}>
          <div style={{ fontSize: 24 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <div>{t("app.error.title")}</div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
            {t("app.error.description")}
          </div>
        </div>
      </PopoverShell>
    );
  }

  return (
    <PopoverShell>
      <Header stats={stats} updater={updater} />
      <SourceSelector />
      <TabBar activeTab={activeTab} onChange={setActiveTab} />

      <div style={{ display: activeTab === "overview" ? "contents" : "none" }}>
        <TodaySummary today={today} weekAvg={weekAvg} />
        <UsageAlertBar />
        <SalaryComparator stats={stats} />
        <DailyChart daily={stats.daily} days={7} />
        <PeriodTotals daily={stats.daily} />
        <Heatmap daily={stats.daily} weeks={8} />
      </div>

      <div style={{ display: activeTab === "analytics" ? "contents" : "none" }}>
        <AnalyticsSubTabs active={analyticsSubTab} onChange={setAnalyticsSubTab} />

        {analyticsSubTab === "usage" && (
          <>
            <AnalyticsSummary stats={stats} />
            <ActivityGraph daily={stats.daily} />
            <DailyChart daily={stats.daily} days={30} />
            <PeriodTotals daily={stats.daily} />
            {stats.analytics && stats.analytics.activity_breakdown.length > 0 && (
              <ActivityBreakdown data={stats.analytics.activity_breakdown} />
            )}
            <ModelBreakdown modelUsage={stats.model_usage} />
            <CacheEfficiency stats={stats} />
          </>
        )}

        {analyticsSubTab === "projects" && (
          stats.analytics && stats.analytics.project_usage.length > 0
            ? <ProjectBreakdown data={stats.analytics.project_usage} />
            : <AnalyticsEmptyState message={t("analytics.empty.projects")} />
        )}

        {analyticsSubTab === "tools" && (
          stats.analytics && stats.analytics.tool_usage.length > 0
            ? <>
                <ToolUsage data={stats.analytics.tool_usage} />
                <ShellCommands
                  commands={stats.analytics.shell_commands}
                  mcp={stats.analytics.mcp_usage}
                />
              </>
            : <AnalyticsEmptyState message={t("analytics.empty.tools")} />
        )}
      </div>
    </PopoverShell>
  );
}

function I18nBridge({ children }: { children: React.ReactNode }) {
  const { prefs } = useSettings();
  return (
    <I18nProvider locale={prefs.language}>
      {children}
    </I18nProvider>
  );
}

function App() {
  return (
    <SettingsProvider>
      <I18nBridge>
        <AppContent />
      </I18nBridge>
    </SettingsProvider>
  );
}

export default App;
