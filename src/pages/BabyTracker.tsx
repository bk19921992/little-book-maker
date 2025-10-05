import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const APP_STORAGE_KEY = "babyTrackerData.v2";

interface Appointment {
  id: number;
  dateTime: string;
  details: string;
}

interface ContractionEntry {
  id: number;
  startISO: string;
  endISO: string;
  durationSec: number;
}

type LogType = "feed" | "nappy" | "activity" | string;

type LogExtra = Record<string, any>;

interface LogEntry {
  id: number;
  type: LogType;
  value: string;
  extra?: LogExtra | undefined;
  timestampISO: string;
}

interface GrowthRecord {
  id: number;
  dateISO: string;
  weightKg: number;
  lengthCm: number;
  headCm: number;
}

interface Milestone {
  id: number;
  text: string;
  age: string;
  completed: boolean;
}

interface NoteEntry {
  id: number;
  text: string;
  timestampISO: string;
}

interface ContractionRule {
  everyMins: number;
  lastingSecs: number;
  repeatCount: number;
}

interface Settings {
  darkMode: boolean;
  contractionRule: ContractionRule;
}

interface AppData {
  lmpDate: string;
  dueDate: string;
  appointments: Appointment[];
  contractions: ContractionEntry[];
  logs: LogEntry[];
  growth: GrowthRecord[];
  milestones: Milestone[];
  notes: NoteEntry[];
  settings: Settings;
}

function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore write errors
    }
  }, [key, state]);

  return [state, setState];
}

function useInterval(callback: () => void, delay: number | null) {
  const savedRef = useRef<() => void>();

  useEffect(() => {
    savedRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay == null) return;
    const id = window.setInterval(() => {
      savedRef.current?.();
    }, delay);
    return () => window.clearInterval(id);
  }, [delay]);
}

function formatHM(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toGBDate(date: string) {
  return new Date(date).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysBetween(a: string, b: string) {
  const start = new Date(a);
  const end = new Date(b);
  const ms = Math.abs(start.setHours(0, 0, 0, 0) - end.setHours(0, 0, 0, 0));
  return Math.round(ms / 86400000);
}

const DEFAULT_MILESTONES: Milestone[] = [
  { id: 1, text: "First smile", age: "6–8 weeks", completed: false },
  { id: 2, text: "Holds head steady", age: "3–4 months", completed: false },
  { id: 3, text: "Rolls over", age: "4–6 months", completed: false },
  { id: 4, text: "Sits without support", age: "6–8 months", completed: false },
  { id: 5, text: "Crawls", age: "7–10 months", completed: false },
  { id: 6, text: "First words", age: "10–14 months", completed: false },
  { id: 7, text: "First steps", age: "12–15 months", completed: false },
];

const prefersDark =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

const DEFAULT_SETTINGS: Settings = {
  darkMode: prefersDark || false,
  contractionRule: { everyMins: 5, lastingSecs: 60, repeatCount: 6 },
};

interface UndoState {
  kind: "log";
  entry: LogEntry;
}

const BabyTrackerApp: React.FC = () => {
  const [data, setData] = useLocalStorage<AppData>(APP_STORAGE_KEY, {
    lmpDate: "",
    dueDate: "",
    appointments: [],
    contractions: [],
    logs: [],
    growth: [],
    milestones: DEFAULT_MILESTONES,
    notes: [],
    settings: DEFAULT_SETTINGS,
  });

  const [tab, setTab] = useState(
    "home" as "home" | "pregnancy" | "contractions" | "baby" | "growth" | "milestones" | "notes" | "settings",
  );
  const [showSheet, setShowSheet] = useState<
    null | "feed" | "nappy" | "activity" | "appt" | "note" | "import" | "growth"
  >(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const pregnancyWeek = useMemo(() => {
    if (!data.lmpDate) return 0;
    const diffDays = Math.floor((Date.now() - new Date(data.lmpDate).getTime()) / 86400000);
    return Math.max(0, Math.floor(diffDays / 7));
  }, [data.lmpDate]);

  const nextAppointment = useMemo(() => {
    const now = Date.now();
    const upcoming = data.appointments
      .filter((appointment) => new Date(appointment.dateTime).getTime() >= now)
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
    return upcoming[0] ?? null;
  }, [data.appointments]);

  const lastFeed = useMemo(() => data.logs.find((log) => log.type === "feed") ?? null, [data.logs]);

  const nappies24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return data.logs.filter(
      (log) => log.type === "nappy" && new Date(log.timestampISO).getTime() >= cutoff,
    ).length;
  }, [data.logs]);

  const feedStats24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const feeds = data.logs
      .filter((log) => log.type === "feed" && new Date(log.timestampISO).getTime() >= cutoff)
      .map((feed) => new Date(feed.timestampISO).getTime());

    if (feeds.length < 2) return { avgMins: null as number | null, count: feeds.length };

    feeds.sort((a, b) => b - a);
    const intervals: number[] = [];

    for (let index = 0; index < feeds.length - 1; index += 1) {
      intervals.push((feeds[index] - feeds[index + 1]) / 60000);
    }

    const avgMins = Math.round((intervals.reduce((acc, value) => acc + value, 0) / intervals.length) * 10) / 10;
    return { avgMins, count: feeds.length };
  }, [data.logs]);

  const contractionSummary = useMemo(() => {
    const recent = data.contractions.slice(0, 10);
    if (recent.length < 2) {
      return { avgMins: null as number | null, count: recent.length, ruleMet: false };
    }

    const starts = recent.map((entry) => new Date(entry.startISO).getTime());
    const intervals: number[] = [];

    for (let index = 0; index < starts.length - 1; index += 1) {
      intervals.push((starts[index] - starts[index + 1]) / 60000);
    }

    const avgMins = Math.round((intervals.reduce((acc, value) => acc + value, 0) / intervals.length) * 10) / 10;
    const { everyMins, lastingSecs, repeatCount } = data.settings.contractionRule;
    const longEnough = recent.slice(0, repeatCount).every((entry) => entry.durationSec >= lastingSecs);
    const fastEnough = intervals.slice(0, repeatCount - 1).every((interval) => interval <= everyMins);

    return { avgMins, count: recent.length, ruleMet: longEnough && fastEnough };
  }, [data.contractions, data.settings.contractionRule]);

  const [isContractionOn, setIsContractionOn] = useState(false);
  const [contractionSeconds, setContractionSeconds] = useState(0);
  const contractionStartRef = useRef<string | null>(null);

  useInterval(() => {
    if (isContractionOn) {
      setContractionSeconds((seconds) => seconds + 1);
    }
  }, isContractionOn ? 1000 : null);

  const setState = (partial: Partial<AppData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  };

  const setLMP = (lmp: string) => {
    const due = new Date(new Date(lmp).getTime() + 280 * 86400000);
    setState({ lmpDate: lmp, dueDate: due.toLocaleDateString("en-GB") });
  };

  const quickLog = (type: LogType, value: string, extra: Record<string, unknown> = {}) => {
    const entry: LogEntry = {
      id: Date.now(),
      type,
      value,
      extra,
      timestampISO: new Date().toISOString(),
    };

    const next = [entry, ...data.logs];
    setState({ logs: next });
    setUndo({ kind: "log", entry });
    window.setTimeout(() => setUndo(null), 5000);
  };

  const deleteLog = (id: number) => setState({ logs: data.logs.filter((log) => log.id !== id) });
  const deleteNote = (id: number) => setState({ notes: data.notes.filter((note) => note.id !== id) });
  const deleteAppt = (id: number) =>
    setState({ appointments: data.appointments.filter((appointment) => appointment.id !== id) });

  const startContraction = () => {
    setIsContractionOn(true);
    setContractionSeconds(0);
    contractionStartRef.current = new Date().toISOString();
  };

  const stopContraction = () => {
    if (!isContractionOn) return;

    const endISO = new Date().toISOString();
    const entry: ContractionEntry = {
      id: Date.now(),
      startISO: contractionStartRef.current ?? endISO,
      endISO,
      durationSec: contractionSeconds,
    };

    setState({ contractions: [entry, ...data.contractions] });
    setIsContractionOn(false);
    setContractionSeconds(0);
  };

  const saveGrowth = (record: Omit<GrowthRecord, "id">) => {
    const next = [...data.growth, { id: Date.now(), ...record }].sort(
      (a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime(),
    );
    setState({ growth: next });
  };

  const toggleMilestone = (id: number) =>
    setState({
      milestones: data.milestones.map((milestone) =>
        milestone.id === id ? { ...milestone, completed: !milestone.completed } : milestone,
      ),
    });

  const exportJSON = () => {
    if (typeof window === "undefined") return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement("a"), {
      href: url,
      download: "baby-tracker-data.json",
    });
    anchor.click();
  };

  const exportCSV = () => {
    if (typeof window === "undefined") return;
    const escape = (value = "") => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ["type", "value", "extra", "timestampISO"],
      ...data.logs.map((log) => [
        log.type,
        log.value,
        JSON.stringify(log.extra ?? {}),
        log.timestampISO,
      ]),
    ];
    const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement("a"), {
      href: url,
      download: "logs.csv",
    });
    anchor.click();
  };

  const handleImportJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(String(reader.result)) as Partial<AppData>;
        setData((prev) => ({ ...prev, ...incoming }));
        setShowSheet(null);
      } catch {
        window.alert("Import failed. Check the file.");
      }
    };
    reader.readAsText(file);
  };

  const growthDelta = useMemo(() => {
    if (data.growth.length < 2) return null;
    const last = data.growth[data.growth.length - 1];
    const previous = data.growth[data.growth.length - 2];
    return {
      weight: +(last.weightKg - previous.weightKg).toFixed(2),
      days: daysBetween(last.dateISO, previous.dateISO),
    };
  }, [data.growth]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", !!data.settings.darkMode);
  }, [data.settings.darkMode]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-neutral-950 text-gray-900 dark:text-gray-100">
      <div className="sticky top-0 z-50 bg-white/90 dark:bg-neutral-900/90 backdrop-blur border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">My Baby &amp; Me</h1>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded-lg text-sm border hover:bg-gray-100 dark:hover:bg-neutral-800"
              onClick={() =>
                setState({ settings: { ...data.settings, darkMode: !data.settings.darkMode } })
              }
              aria-label="Toggle dark mode"
            >
              {data.settings.darkMode ? "Light" : "Dark"}
            </button>
            <button
              className="px-3 py-1 rounded-lg text-sm border hover:bg-gray-100 dark:hover:bg-neutral-800"
              onClick={exportJSON}
            >
              Export
            </button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-1 pb-1">
          <nav className="grid grid-cols-7 gap-1 text-sm">
            {[
              ["home", "Home", "🏠"],
              ["pregnancy", "Pregnancy", "🤰"],
              ["contractions", "Contractions", "⏱️"],
              ["baby", "Baby log", "🍼"],
              ["growth", "Growth", "📈"],
              ["milestones", "Milestones", "⭐"],
              ["notes", "Notes", "📝"],
            ].map(([id, label, icon]) => (
              <button
                key={id}
                onClick={() => setTab(id as typeof tab)}
                className={`py-2 rounded-lg ${
                  tab === id ? "bg-blue-500 text-white" : "hover:bg-gray-100 dark:hover:bg-neutral-800"
                }`}
                aria-current={tab === id ? "page" : undefined}
              >
                <div className="flex flex-col items-center leading-none">
                  <span aria-hidden>{icon}</span>
                  <span className="text-[11px] mt-1">{label}</span>
                </div>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-3xl mx-auto p-4 pb-28">
        {tab === "home" && (
          <section className="space-y-4">
            <Card>
              <div className="grid grid-cols-2 gap-3">
                <SummaryItem label="Pregnancy week" value={pregnancyWeek || "—"} />
                <SummaryItem label="Due date" value={data.dueDate || "Set LMP"} />
                <SummaryItem
                  label="Next appointment"
                  value={nextAppointment ? toGBDate(nextAppointment.dateTime) : "None"}
                />
                <SummaryItem
                  label="Last feed"
                  value={lastFeed ? timeAgo(new Date(lastFeed.timestampISO)) : "No feeds yet"}
                />
                <SummaryItem
                  label="Feeds 24h"
                  value={feedStats24h.count ? `${feedStats24h.count} (${feedStats24h.avgMins ?? "–"}m avg)` : "0"}
                />
                <SummaryItem label="Nappies 24h" value={String(nappies24h)} />
                <SummaryItem
                  label="Contractions avg"
                  value={contractionSummary.avgMins ? `${contractionSummary.avgMins}m` : "—"}
                />
                <SummaryItem
                  label="Rule status"
                  value={contractionSummary.ruleMet ? "Threshold met" : "Not met"}
                />
              </div>
            </Card>

            <SmartHints
              lastFeed={lastFeed}
              feedStats24h={feedStats24h}
              contractionSummary={contractionSummary}
              settings={data.settings}
            />
          </section>
        )}

        {tab === "pregnancy" && (
          <section className="space-y-4">
            <Header title={`Week ${pregnancyWeek}`} subtitle="Pregnancy overview" />
            <Card>
              <h3 className="font-semibold mb-3">Due date calculator</h3>
              <label className="block text-sm mb-2">Last menstrual period</label>
              <input
                type="date"
                value={data.lmpDate}
                onChange={(event) => setLMP(event.target.value)}
                className="w-full p-3 border rounded-lg bg-white dark:bg-neutral-900"
              />
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                Estimated due date: <span className="font-medium">{data.dueDate || "—"}</span>
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Appointments</h3>
                <button className="btn" onClick={() => setShowSheet("appt")}>Add</button>
              </div>
              {data.appointments.length === 0 && <Empty text="No appointments yet" />}
              <ul className="space-y-2">
                {[...data.appointments]
                  .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
                  .map((appointment) => (
                    <li key={appointment.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border">
                      <div>
                        <div className="text-sm text-gray-600 dark:text-gray-300">
                          {toGBDate(appointment.dateTime)}
                        </div>
                        <div className="mt-1">{appointment.details}</div>
                      </div>
                      <button
                        className="text-red-500"
                        onClick={() => deleteAppt(appointment.id)}
                        aria-label="Delete appointment"
                      >
                        ×
                      </button>
                    </li>
                  ))}
              </ul>
            </Card>
          </section>
        )}

        {tab === "contractions" && (
          <section className="space-y-4">
            <Header title="Contractions" subtitle="Timer and recent entries" />
            <Card>
              <div className="text-center my-4">
                <div className="text-5xl font-semibold" aria-live="polite">
                  {formatHM(contractionSeconds)}
                </div>
              </div>
              <div className="flex gap-3">
                {!isContractionOn ? (
                  <button className="btn-primary flex-1" onClick={startContraction}>
                    Start
                  </button>
                ) : (
                  <button className="btn-danger flex-1" onClick={stopContraction}>
                    End
                  </button>
                )}
              </div>
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                Thresholds: every {data.settings.contractionRule.everyMins} mins, lasting {
                  data.settings.contractionRule.lastingSecs
                }
                s, repeats {data.settings.contractionRule.repeatCount}.
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold mb-3">Recent</h3>
              {data.contractions.length === 0 && <Empty text="No contractions yet" />}
              <ul className="space-y-2">
                {data.contractions.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        {toGBDate(entry.startISO)}
                      </div>
                      <div className="mt-1">Duration {Math.round(entry.durationSec)}s</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {tab === "baby" && (
          <section className="space-y-4">
            <Header title="Baby log" subtitle="Feeds, nappies, sleep, activities" />
            <Card>
              <div className="grid grid-cols-3 gap-2">
                <button className="tile" onClick={() => setShowSheet("feed")}>
                  🤱 Feed
                </button>
                <button className="tile" onClick={() => setShowSheet("nappy")}>
                  🧷 Nappy
                </button>
                <button className="tile" onClick={() => setShowSheet("activity")}>
                  😴 Activity
                </button>
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold mb-3">Recent entries</h3>
              {data.logs.length === 0 && <Empty text="No logs yet" />}
              <ul className="space-y-2">
                {data.logs.slice(0, 30).map((log) => (
                  <li key={log.id} className="flex items-start justify-between p-3 rounded-lg border">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        {toGBDate(log.timestampISO)}
                      </div>
                      <div className="mt-1 font-medium">{labelForLog(log)}</div>
                      {log.extra && Object.keys(log.extra).length > 0 && (
                        <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                          {Object.entries(log.extra).map(([key, value]) => (
                            <span key={key} className="mr-3">
                              {key}: <b>{String(value)}</b>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button className="text-red-500" onClick={() => deleteLog(log.id)} aria-label="Delete log">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {tab === "growth" && (
          <section className="space-y-4">
            <Header title="Growth" subtitle="Weight, length, head" />
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Record growth</h3>
                <button className="btn" onClick={() => setShowSheet("growth")}>
                  Add
                </button>
              </div>
              {data.growth.length > 0 ? (
                <div className="space-y-3">
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    {growthDelta
                      ? `Δ weight ${growthDelta.weight >= 0 ? "+" : ""}${growthDelta.weight} kg over ${growthDelta.days} days`
                      : "Add one more entry to see change"}
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.growth}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="dateISO" />
                        <YAxis yAxisId="left" />
                        <Tooltip />
                        <Line yAxisId="left" type="monotone" dataKey="weightKg" name="Weight (kg)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <Empty text="No growth data yet" />
              )}
            </Card>
          </section>
        )}

        {tab === "milestones" && (
          <section className="space-y-4">
            <Header title="Milestones" subtitle="Tick as you go" />
            <Card>
              <ul className="space-y-2">
                {data.milestones.map((milestone) => (
                  <li
                    key={milestone.id}
                    className={`flex items-center p-3 rounded-lg border ${
                      milestone.completed ? "opacity-60 line-through" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mr-3 w-5 h-5"
                      checked={milestone.completed}
                      onChange={() => toggleMilestone(milestone.id)}
                    />
                    <div className="flex-1">
                      <div>{milestone.text}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-300">{milestone.age}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {tab === "notes" && (
          <section className="space-y-4">
            <Header title="Notes" subtitle="Quick journal" />
            <Card>
              <button className="btn-primary" onClick={() => setShowSheet("note")}>
                Add note
              </button>
            </Card>
            {data.notes.length === 0 && <Empty text="No notes yet" />}
            {data.notes.map((note) => (
              <Card key={note.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      {toGBDate(note.timestampISO)}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap">{note.text}</div>
                  </div>
                  <button className="text-red-500" onClick={() => deleteNote(note.id)} aria-label="Delete note">
                    ×
                  </button>
                </div>
              </Card>
            ))}
          </section>
        )}

        {tab === "settings" && (
          <section className="space-y-4">
            <Header title="Settings" subtitle="Data and preferences" />
            <Card>
              <h3 className="font-semibold mb-3">Data</h3>
              <div className="flex gap-2 flex-wrap">
                <button className="btn" onClick={exportJSON}>
                  Export JSON
                </button>
                <button className="btn" onClick={exportCSV}>
                  Export CSV (logs)
                </button>
                <button className="btn" onClick={() => setShowSheet("import")}>
                  Import JSON
                </button>
                <button
                  className="btn-danger"
                  onClick={() => {
                    if (window.confirm("Reset all data on this device")) {
                      window.localStorage.removeItem(APP_STORAGE_KEY);
                      window.location.reload();
                    }
                  }}
                >
                  Reset all
                </button>
              </div>
            </Card>
            <Card>
              <h3 className="font-semibold mb-3">Contraction thresholds</h3>
              <ThresholdEditor
                rule={data.settings.contractionRule}
                onChange={(rule) => setState({ settings: { ...data.settings, contractionRule: rule } })}
              />
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2">
                These thresholds are for app notifications only. They are not medical advice.
              </p>
            </Card>
          </section>
        )}
      </main>

      <div className="fixed bottom-20 right-5 z-40">
        {tab === "baby" && (
          <button className="fab" onClick={() => setShowSheet("feed")} aria-label="Add feed">
            ＋
          </button>
        )}
        {tab === "pregnancy" && (
          <button className="fab" onClick={() => setShowSheet("appt")} aria-label="Add appointment">
            ＋
          </button>
        )}
        {tab === "notes" && (
          <button className="fab" onClick={() => setShowSheet("note")} aria-label="Add note">
            ＋
          </button>
        )}
        {tab === "growth" && (
          <button className="fab" onClick={() => setShowSheet("growth")} aria-label="Add growth">
            ＋
          </button>
        )}
      </div>

      {showSheet === "feed" && (
        <Sheet title="Log feed" onClose={() => setShowSheet(null)}>
          <FeedForm
            onSave={(payload) => {
              quickLog("feed", payload.mode, payload);
              setShowSheet(null);
            }}
          />
        </Sheet>
      )}
      {showSheet === "nappy" && (
        <Sheet title="Log nappy" onClose={() => setShowSheet(null)}>
          <NappyForm
            onSave={(payload) => {
              quickLog("nappy", payload.kind, payload);
              setShowSheet(null);
            }}
          />
        </Sheet>
      )}
      {showSheet === "activity" && (
        <Sheet title="Log activity" onClose={() => setShowSheet(null)}>
          <ActivityForm
            onSave={(payload) => {
              quickLog("activity", payload.kind, payload);
              setShowSheet(null);
            }}
          />
        </Sheet>
      )}
      {showSheet === "appt" && (
        <Sheet title="Add appointment" onClose={() => setShowSheet(null)}>
          <ApptForm
            onSave={(appointment) => {
              setState({ appointments: [...data.appointments, appointment] });
              setShowSheet(null);
            }}
          />
        </Sheet>
      )}
      {showSheet === "note" && (
        <Sheet title="Add note" onClose={() => setShowSheet(null)}>
          <NoteForm
            onSave={(text) => {
              setState({
                notes: [{ id: Date.now(), text, timestampISO: new Date().toISOString() }, ...data.notes],
              });
              setShowSheet(null);
            }}
          />
        </Sheet>
      )}
      {showSheet === "import" && (
        <Sheet title="Import JSON" onClose={() => setShowSheet(null)}>
          <input
            type="file"
            accept="application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleImportJSON(file);
            }}
          />
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
            This replaces matching fields only.
          </p>
        </Sheet>
      )}
      {showSheet === "growth" && (
        <Sheet title="Add growth" onClose={() => setShowSheet(null)}>
          <GrowthForm
            onSave={(record) => {
              saveGrowth(record);
              setShowSheet(null);
            }}
          />
        </Sheet>
      )}

      {undo && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-black text-white px-4 py-2 rounded-lg shadow-lg">
          Saved.
          <button
            className="underline ml-2"
            onClick={() => {
              if (undo.kind === "log") {
                setState({ logs: data.logs.filter((log) => log.id !== undo.entry.id) });
              }
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}

      <style>{`
        .btn { padding: 0.5rem 0.75rem; border: 1px solid rgba(0,0,0,0.12); border-radius: 0.5rem; }
        .btn-primary { padding: 0.75rem 1rem; background:#3b82f6; color:white; border-radius:0.75rem; }
        .btn-danger { padding: 0.75rem 1rem; background:#ef4444; color:white; border-radius:0.75rem; }
        .tile { padding: 0.9rem; border:1px solid rgba(0,0,0,0.12); border-radius:0.75rem; background: white; }
        .fab { width:56px; height:56px; border-radius:9999px; background:#3b82f6; color:white; font-size:28px; line-height:56px; text-align:center; box-shadow:0 4px 16px rgba(0,0,0,0.25); }
        .dark .tile { background: #0b0b0b; border-color:#2a2a2a; }
      `}</style>
    </div>
  );
};

interface CardProps {
  children: ReactNode;
}

const Card: React.FC<CardProps> = ({ children }) => (
  <div className="bg-white dark:bg-neutral-900 rounded-xl p-4 shadow-sm border">{children}</div>
);

const Header: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div>
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="text-sm text-gray-600 dark:text-gray-300">{subtitle}</p>
  </div>
);

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-sm text-gray-600 dark:text-gray-300">{text}</div>
);

const SummaryItem: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="p-3 rounded-lg border">
    <div className="text-xs text-gray-600 dark:text-gray-300">{label}</div>
    <div className="text-lg font-semibold mt-1">{value}</div>
  </div>
);

const Sheet: React.FC<{ title: string; onClose: () => void; children: ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
  <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4">
    <div className="bg-white dark:bg-neutral-900 rounded-2xl w-full max-w-md p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <button onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {children}
    </div>
  </div>
);

const ThresholdEditor: React.FC<{
  rule: ContractionRule;
  onChange: (rule: ContractionRule) => void;
}> = ({ rule, onChange }) => (
  <div className="grid grid-cols-3 gap-2">
    <NumberField
      label="Every (mins)"
      value={rule.everyMins}
      onChange={(value) => onChange({ ...rule, everyMins: value })}
    />
    <NumberField
      label="Lasting (secs)"
      value={rule.lastingSecs}
      onChange={(value) => onChange({ ...rule, lastingSecs: value })}
    />
    <NumberField
      label="Repeat (count)"
      value={rule.repeatCount}
      onChange={(value) => onChange({ ...rule, repeatCount: value })}
    />
  </div>
);

const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
}> = ({ label, value, onChange }) => (
  <label className="text-sm">
    <div className="mb-1">{label}</div>
    <input
      type="number"
      className="w-full p-2 border rounded-lg bg-white dark:bg-neutral-900"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
);

const FeedForm: React.FC<{
  onSave: (payload: { mode: string; side?: string; duration?: number; volumeMl?: number }) => void;
}> = ({ onSave }) => {
  const [mode, setMode] = useState("Breast");
  const [side, setSide] = useState("Left");
  const [duration, setDuration] = useState(15);
  const [volumeMl, setVolumeMl] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          mode,
          side,
          duration: Number(duration),
          volumeMl: volumeMl ? Number(volumeMl) : undefined,
        });
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Mode
        <select
          className="w-full p-2 border rounded-lg mt-1 bg-white dark:bg-neutral-900"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option>Breast</option>
          <option>Bottle</option>
          <option>Pump</option>
        </select>
      </label>
      {mode === "Breast" && (
        <>
          <label className="block text-sm">
            Side
            <select
              className="w-full p-2 border rounded-lg mt-1 bg-white dark:bg-neutral-900"
              value={side}
              onChange={(event) => setSide(event.target.value)}
            >
              <option>Left</option>
              <option>Right</option>
              <option>Both</option>
            </select>
          </label>
          <label className="block text-sm">
            Duration minutes
            <input
              type="number"
              className="w-full p-2 border rounded-lg mt-1 bg-white dark:bg-neutral-900"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </label>
        </>
      )}
      {(mode === "Bottle" || mode === "Pump") && (
        <label className="block text-sm">
          Volume ml
          <input
            type="number"
            className="w-full p-2 border rounded-lg mt-1 bg-white dark:bg-neutral-900"
            value={volumeMl}
            onChange={(event) => setVolumeMl(event.target.value)}
          />
        </label>
      )}
      <button className="btn-primary w-full" type="submit">
        Save feed
      </button>
    </form>
  );
};

const NappyForm: React.FC<{ onSave: (payload: { kind: string; notes: string }) => void }> = ({ onSave }) => {
  const [kind, setKind] = useState("Wet");
  const [notes, setNotes] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ kind, notes });
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Type
        <select
          className="w-full p-2 border rounded-lg mt-1 bg-white dark:bg-neutral-900"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option>Wet</option>
          <option>Dirty</option>
          <option>Mixed</option>
        </select>
      </label>
      <label className="block text-sm">
        Notes
        <input
          className="w-full p-2 border rounded-lg mt-1 bg-white dark:bg-neutral-900"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional"
        />
      </label>
      <button className="btn-primary w-full" type="submit">
        Save nappy
      </button>
    </form>
  );
};

const ActivityForm: React.FC<{ onSave: (payload: { kind: string; minutes: number }) => void }> = ({
  onSave,
}) => {
  const [kind, setKind] = useState("Sleep");
  const [minutes, setMinutes] = useState(30);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ kind, minutes: Number(minutes) });
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Activity
        <select
          className="w-full p-2 border rounded-lg mt-1 bg-white dark:bg-neutral-900"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option>Sleep</option>
          <option>Tummy time</option>
          <option>Bath</option>
          <option>Walk</option>
        </select>
      </label>
      <label className="block text-sm">
        Minutes
        <input
          type="number"
          className="w-full p-2 border rounded-lg mt-1 bg-white dark:bg-neutral-900"
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
        />
      </label>
      <button className="btn-primary w-full" type="submit">
        Save activity
      </button>
    </form>
  );
};

const ApptForm: React.FC<{ onSave: (appointment: Appointment) => void }> = ({ onSave }) => {
  const [dateTime, setDateTime] = useState("");
  const [details, setDetails] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ id: Date.now(), dateTime, details });
      }}
      className="space-y-3"
    >
      <input
        type="datetime-local"
        className="w-full p-2 border rounded-lg bg-white dark:bg-neutral-900"
        value={dateTime}
        onChange={(event) => setDateTime(event.target.value)}
      />
      <textarea
        className="w-full p-2 border rounded-lg bg-white dark:bg-neutral-900"
        rows={3}
        value={details}
        placeholder="e.g. Ultrasound"
        onChange={(event) => setDetails(event.target.value)}
      />
      <button className="btn-primary w-full" type="submit">
        Save appointment
      </button>
    </form>
  );
};

const NoteForm: React.FC<{ onSave: (text: string) => void }> = ({ onSave }) => {
  const [text, setText] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) {
          onSave(text);
        }
      }}
      className="space-y-3"
    >
      <textarea
        className="w-full p-2 border rounded-lg bg-white dark:bg-neutral-900"
        rows={5}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Write your note..."
      />
      <button className="btn-primary w-full" type="submit">
        Save note
      </button>
    </form>
  );
};

const GrowthForm: React.FC<{
  onSave: (record: { dateISO: string; weightKg: number; lengthCm: number; headCm: number }) => void;
}> = ({ onSave }) => {
  const [dateISO, setDateISO] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [lengthCm, setLengthCm] = useState("");
  const [headCm, setHeadCm] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!dateISO || !weightKg || !lengthCm || !headCm) return;
        onSave({
          dateISO,
          weightKg: Number(weightKg),
          lengthCm: Number(lengthCm),
          headCm: Number(headCm),
        });
      }}
      className="space-y-3"
    >
      <input
        type="date"
        className="w-full p-2 border rounded-lg bg-white dark:bg-neutral-900"
        value={dateISO}
        onChange={(event) => setDateISO(event.target.value)}
      />
      <input
        type="number"
        step="0.01"
        className="w-full p-2 border rounded-lg bg-white dark:bg-neutral-900"
        value={weightKg}
        placeholder="Weight (kg)"
        onChange={(event) => setWeightKg(event.target.value)}
      />
      <input
        type="number"
        step="0.1"
        className="w-full p-2 border rounded-lg bg-white dark:bg-neutral-900"
        value={lengthCm}
        placeholder="Length (cm)"
        onChange={(event) => setLengthCm(event.target.value)}
      />
      <input
        type="number"
        step="0.1"
        className="w-full p-2 border rounded-lg bg-white dark:bg-neutral-900"
        value={headCm}
        placeholder="Head (cm)"
        onChange={(event) => setHeadCm(event.target.value)}
      />
      <button className="btn-primary w-full" type="submit">
        Save measurement
      </button>
    </form>
  );
};

function labelForLog(log: LogEntry) {
  if (log.type === "feed") {
    const bits = [log.value];
    if (log.extra?.side && log.extra.side !== "Both") bits.push(String(log.extra.side));
    if (log.extra?.duration) bits.push(`${log.extra.duration}m`);
    if (log.extra?.volumeMl) bits.push(`${log.extra.volumeMl} ml`);
    return `Feed: ${bits.join(" · ")}`;
  }
  if (log.type === "nappy") {
    return `Nappy: ${log.value}${log.extra?.notes ? " · " + log.extra.notes : ""}`;
  }
  if (log.type === "activity") {
    return `Activity: ${log.value}${log.extra?.minutes ? " · " + log.extra.minutes + "m" : ""}`;
  }
  return `${log.type}: ${log.value}`;
}

function timeAgo(dateObj: Date) {
  const diffMin = Math.floor((Date.now() - dateObj.getTime()) / 60000);
  if (diffMin < 1) return "Just now";
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  return hours > 0 ? `${hours}h ${minutes}m ago` : `${minutes}m ago`;
}

const SmartHints: React.FC<{
  lastFeed: LogEntry | null;
  feedStats24h: { avgMins: number | null; count: number };
  contractionSummary: { avgMins: number | null; count: number; ruleMet: boolean };
}> = ({ lastFeed, feedStats24h, contractionSummary }) => {
  const hints: string[] = [];
  if (lastFeed) {
    const mins = Math.floor((Date.now() - new Date(lastFeed.timestampISO).getTime()) / 60000);
    if (mins > 180) hints.push(`It has been ${Math.floor(mins / 60)}h since last feed.`);
  }
  if (feedStats24h.count >= 2 && feedStats24h.avgMins) {
    hints.push(`Average feed interval in the last 24h is ${feedStats24h.avgMins} minutes.`);
  }
  if (contractionSummary.avgMins) {
    hints.push(`Average contraction interval is ${contractionSummary.avgMins} minutes.`);
    if (contractionSummary.ruleMet) {
      hints.push(`Your current intervals meet your chosen threshold. Consider following your birth plan instructions.`);
    }
  }
  if (hints.length === 0) return null;
  return (
    <Card>
      <h3 className="font-semibold mb-2">Smart summary</h3>
      <ul className="list-disc pl-5 space-y-1 text-sm">
        {hints.map((hint, index) => (
          <li key={index}>{hint}</li>
        ))}
      </ul>
    </Card>
  );
};

export default BabyTrackerApp;
