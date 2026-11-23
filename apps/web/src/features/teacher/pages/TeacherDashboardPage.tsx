import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Compass,
  Leaf,
  MapPin,
  Sprout,
} from 'lucide-react';
import grasshopperIdle from '@/assets/grillo/grillo1.png';
import { FloatingIsland } from '@/components/ui/FloatingIsland';
import { api, ApiError } from '@/services/api/client';
import type {
  FailureReason,
  GroupStatistics,
  StudentAttempt,
  StudentOverview,
  StudentStatistics,
  TeacherDashboard,
  WorldSummary,
} from '@/services/api/types';
import { InsightsHeader } from '@/components/common/InsightsHeader';
import { ScreenMessage } from '@/components/ui/ScreenMessage';
import styles from './TeacherDashboardPage.module.css';

type StudentStatus = 'support' | 'watch' | 'good' | 'none';

/** Las «islas» del mapa son los motivos de fallo que registra la API (no existe una taxonomía de temas). */
const failureReasons: { reason: FailureReason; label: string; x: number; y: number }[] = [
  { reason: 'WRONG_RESULT', label: 'Resultado erróneo', x: 13, y: 13 },
  { reason: 'RULE_VIOLATION', label: 'Reglas incumplidas', x: 43, y: 5 },
  { reason: 'TIMEOUT', label: 'Tiempo agotado', x: 77, y: 13 },
  { reason: 'SYNTAX_ERROR', label: 'Sintaxis', x: 23, y: 45 },
  { reason: 'CLAIMED_RESULT_MISMATCH', label: 'Resultado declarado', x: 57, y: 41 },
  { reason: 'DIVISION_BY_ZERO', label: 'División entre cero', x: 83, y: 49 },
];

const statusLabels: Record<StudentStatus, string> = {
  support: 'Necesita apoyo',
  watch: 'En observación',
  good: 'Buen rendimiento',
  none: 'Sin actividad',
};

const statusOrder: Record<StudentStatus, number> = { support: 0, watch: 1, good: 2, none: 3 };

const TRAIL_STAGES = 5;

const formatPercent = (value: number | null) => (value === null ? '—' : `${Math.round(value)}%`);

const errorsOf = (student: StudentOverview) => student.totals.incorrect + student.totals.timeouts;

function getDifficulty(errors: number, maximum: number) {
  if (errors === 0 || errors / maximum < 0.3) return 'calm' as const;
  if (errors / maximum < 0.65) return 'watch' as const;
  return 'high' as const;
}

function getDifficultyLabel(level: ReturnType<typeof getDifficulty>) {
  if (level === 'high') return 'Refuerzo prioritario';
  if (level === 'watch') return 'Conviene practicar';
  return 'Buen dominio';
}

/** Precisión por etapas, calculada con el historial real de intentos resueltos (del más antiguo al más reciente). */
function getAccuracyHistory(attempts: StudentAttempt[]): number[] | null {
  const resolved = attempts.filter((attempt) => attempt.outcome !== 'PENDING').reverse();
  if (resolved.length < TRAIL_STAGES) return null;
  const stages = Array.from({ length: TRAIL_STAGES }, () => ({ correct: 0, total: 0 }));
  resolved.forEach((attempt, index) => {
    const stage = stages[Math.floor((index * TRAIL_STAGES) / resolved.length)];
    stage.total += 1;
    if (attempt.outcome === 'CORRECT') stage.correct += 1;
  });
  return stages.map((stage) => Math.round((stage.correct / stage.total) * 100));
}

function LearningTrail({ history, attemptCount }: { history: number[] | null; attemptCount: number }) {
  if (!history) {
    return (
      <div className={styles.learningTrail}>
        <div className={styles.trailHeading}>
          <span>
            <Compass size={14} /> Recorrido de precisión
          </span>
        </div>
        <p className={styles.emptyState}>
          Aún no hay suficientes intentos ({attemptCount} de {TRAIL_STAGES}) para mostrar el recorrido.
        </p>
      </div>
    );
  }

  const points = history.map((accuracy, index) => `${20 + index * 70},${75 - accuracy * 0.58}`).join(' ');
  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  const improved = current >= previous;

  return (
    <div className={styles.learningTrail}>
      <div className={styles.trailHeading}>
        <span>
          <Compass size={14} /> Recorrido de precisión
        </span>
        <strong className={improved ? styles.trendUp : styles.trendDown}>
          {improved ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {current - previous > 0 ? '+' : ''}
          {current - previous} pts
        </strong>
      </div>
      <svg
        viewBox="0 0 320 88"
        role="img"
        aria-label={`Precisión en cinco etapas: ${history.join(', ')} por ciento`}
      >
        <polyline points={points} className={styles.trailPath} />
        {history.map((accuracy, index) => {
          const x = 20 + index * 70;
          const y = 75 - accuracy * 0.58;
          return (
            <g key={`${accuracy}-${index}`}>
              <circle
                cx={x}
                cy={y}
                r="9"
                className={index === history.length - 1 ? styles.currentTrailPoint : styles.trailPoint}
              />
              <text x={x} y={y + 3} textAnchor="middle" className={styles.trailPointLabel}>
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={styles.trailLabels}>
        <span>Primera etapa</span>
        <span>Actual · {current}%</span>
      </div>
    </div>
  );
}

type GroupData = { statistics: GroupStatistics; students: StudentOverview[] };

/** «Mundo N» para un slug (las secuencias tienen longitudes distintas: el reto N solo tiene sentido con su mundo). */
const worldLabel = (worlds: WorldSummary[], slug: string) => {
  const world = worlds.find((item) => item.slug === slug);
  return world ? `Mundo ${world.position}` : slug;
};
const worldOrder = (worlds: WorldSummary[], slug: string) =>
  worlds.find((item) => item.slug === slug)?.position ?? Number.MAX_SAFE_INTEGER;
type StudentDetail = { statistics: StudentStatistics; attempts: StudentAttempt[] };

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'No se pudo cargar la información.';

export function TeacherDashboardPage() {
  const [dashboard, setDashboard] = useState<TeacherDashboard | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupData, setGroupData] = useState<GroupData | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState<FailureReason | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  /** Catálogo de mundos, solo para nombrar y ordenar los retos; si falla, se muestran los slugs. */
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .worlds()
      .then((data) => {
        if (!cancelled) setWorlds(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .teacherDashboard()
      .then((data) => {
        if (cancelled) return;
        setDashboard(data);
        setGroupId((current) => current ?? data.groups[0]?.group.id ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setDashboardError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retryDashboard = () => {
    setDashboardError(null);
    setReloadKey((key) => key + 1);
  };

  // Los restablecimientos de estado viven en los manejadores de eventos (no en los efectos de carga).
  const selectGroup = (id: string) => {
    if (id === groupId) return;
    setGroupId(id);
    setGroupData(null);
    setGroupError(null);
    setSelectedId(null);
    setSelectedReason(null);
    setDetail(null);
    setDetailError(null);
  };

  const selectStudent = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
  };

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    Promise.all([api.groupStatistics(groupId), api.groupStudents(groupId)])
      .then(([statistics, students]) => {
        if (cancelled) return;
        setGroupData({ statistics, students: students.items });
        setSelectedId(students.items[0]?.student.id ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setGroupError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !selectedId) return;
    let cancelled = false;
    Promise.all([api.studentStatistics(groupId, selectedId), api.studentAttempts(groupId, selectedId)])
      .then(([statistics, attempts]) => {
        if (!cancelled) setDetail({ statistics, attempts: attempts.items });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setDetailError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, selectedId]);

  const attentionIds = useMemo(
    () => new Set(groupData?.statistics.studentsNeedingAttention.map((item) => item.student.id)),
    [groupData],
  );

  if (dashboardError) {
    return (
      <ScreenMessage title="No pudimos cargar tu panel">
        <p>{dashboardError}</p>
        <button type="button" onClick={retryDashboard}>
          Reintentar
        </button>
      </ScreenMessage>
    );
  }
  if (!dashboard) return <ScreenMessage title="Cargando panel…" />;

  const currentGroup = dashboard.groups.find((item) => item.group.id === groupId);

  if (!currentGroup) {
    return (
      <main className={styles.page}>
        <InsightsHeader activePage="teacher" />
        <div className={styles.content}>
          <header className={styles.intro}>
            <div>
              <span className={styles.eyebrow}>
                <Compass size={14} /> MAPA DEL BOSQUE NUMÉRICO
              </span>
              <h1>Mapa de conocimientos</h1>
              <p>Todavía no tienes grupos activos asignados. Pide a un administrador que te asigne uno.</p>
            </div>
          </header>
        </div>
      </main>
    );
  }

  const getStatus = (student: StudentOverview): StudentStatus => {
    if (attentionIds.has(student.student.id)) return 'support';
    const accuracy = student.totals.accuracyPercent;
    if (accuracy === null) return 'none';
    return accuracy < 80 ? 'watch' : 'good';
  };

  const activity = currentGroup.activity;
  const students = groupData?.students ?? [];
  const statistics = groupData?.statistics;
  const sortedStudents = [...students].sort((a, b) => {
    const statusDifference = statusOrder[getStatus(a)] - statusOrder[getStatus(b)];
    return statusDifference || errorsOf(b) - errorsOf(a);
  });
  const selectedStudent = students.find((student) => student.student.id === selectedId) ?? null;

  const reasonTotals = failureReasons.map((item) => {
    const matching = statistics?.commonErrors.filter((error) => error.reason === item.reason) ?? [];
    return { ...item, errors: matching.reduce((total, error) => total + error.count, 0) };
  });
  const totalReasonErrors = reasonTotals.reduce((total, item) => total + item.errors, 0);
  const maximumReasonErrors = Math.max(...reasonTotals.map(({ errors }) => errors), 1);
  const topReason = reasonTotals.reduce(
    (top, item) => (item.errors > top.errors ? item : top),
    reasonTotals[0],
  );
  const activeReason = reasonTotals.find((item) => item.reason === selectedReason) ?? topReason;
  const reasonDifficulty = getDifficulty(activeReason.errors, maximumReasonErrors);
  const reasonFrequency =
    totalReasonErrors === 0 ? 0 : Math.round((activeReason.errors / totalReasonErrors) * 100);
  const attentionStudents = statistics?.studentsNeedingAttention.slice(0, 3) ?? [];
  const practiceItems =
    activeReason.reason === 'RULE_VIOLATION'
      ? (statistics?.frequentlyViolatedRules ?? []).slice(0, 3).map((rule) => ({
          key: rule.ruleKey,
          label: rule.description ?? rule.ruleKey,
          count: rule.violations,
        }))
      : (statistics?.challengesNeedingReinforcement ?? []).slice(0, 3).map((challenge) => ({
          key: `${challenge.worldSlug}-${challenge.position}-${challenge.expression}`,
          label: `${worldLabel(worlds, challenge.worldSlug)} · Reto ${challenge.position} · ${challenge.expression}`,
          count: challenge.failures,
        }));

  const detailWorlds = [...(detail?.statistics.worlds ?? [])].sort(
    (a, b) => worldOrder(worlds, a.worldSlug) - worldOrder(worlds, b.worldSlug),
  );
  // Cada mundo tiene secuencias de longitud variable: los retos se identifican por mundo y posición (1..N).
  const masteredChallenges = detailWorlds.flatMap((world) =>
    world.challenges
      .filter((challenge) => challenge.attempts > 0 && challenge.failures === 0)
      .sort((a, b) => a.position - b.position)
      .map((challenge) => ({
        key: `${world.worldSlug}-${challenge.position}-${challenge.expression}`,
        label: `${world.worldName} · Reto ${challenge.position}`,
      })),
  );
  const reinforcement = [
    ...detailWorlds.flatMap((world) =>
      world.violatedRules.map((rule) => ({
        key: `rule-${world.worldSlug}-${rule.ruleKey}`,
        label: rule.description ?? rule.ruleKey,
        count: rule.violations,
      })),
    ),
    ...detailWorlds.flatMap((world) =>
      world.challenges
        .filter((challenge) => challenge.failures > 0)
        .map((challenge) => ({
          key: `challenge-${world.worldSlug}-${challenge.position}-${challenge.expression}`,
          label: `${world.worldName} · Reto ${challenge.position}`,
          count: challenge.failures,
        })),
    ),
  ]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const studentStatus = selectedStudent ? getStatus(selectedStudent) : 'none';

  return (
    <main className={styles.page}>
      <InsightsHeader activePage="teacher" />
      <div className={styles.content}>
        <header className={styles.intro}>
          <div>
            <span className={styles.eyebrow}>
              <Compass size={14} /> MAPA DEL BOSQUE NUMÉRICO
            </span>
            <h1>Mapa de conocimientos</h1>
            <p>Explora las islas y descubre dónde acompañar el próximo aprendizaje.</p>
          </div>
          <div className={styles.demoSign}>
            <span>GRUPO</span>
            {dashboard.groups.length > 1 ? (
              <select
                className={styles.groupSelect}
                value={currentGroup.group.id}
                onChange={(event) => selectGroup(event.target.value)}
                aria-label="Grupo"
              >
                {dashboard.groups.map(({ group }) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{currentGroup.group.name}</strong>
            )}
          </div>
        </header>

        <div className={styles.groupTrail} aria-label="Resumen del grupo">
          <span>
            <i className={styles.groupMarker} />
            {activity.studentCount} aprendices
          </span>
          <span>
            <i className={styles.errorMarker} />
            {activity.totals.incorrect + activity.totals.timeouts} errores revisados
          </span>
          <span>
            <i className={styles.accuracyMarker} />
            {formatPercent(activity.totals.accuracyPercent)} precisión del grupo
          </span>
        </div>

        {groupError && (
          <p className={styles.emptyState} role="alert">
            {groupError}
          </p>
        )}
        {!groupData && !groupError && (
          <p className={styles.emptyState} role="status">
            Cargando el grupo…
          </p>
        )}

        {groupData && (
          <>
            <section className={styles.mapSection} aria-labelledby="map-title">
              <div className={styles.mapHeading}>
                <div>
                  <span className={styles.eyebrow}>RECORRIDO DEL GRUPO</span>
                  <h2 id="map-title">Islas de aprendizaje</h2>
                </div>
                <span className={styles.mapHint}>Selecciona una isla para inspeccionar sus huellas</span>
              </div>

              <div className={styles.mapArea}>
                <svg
                  className={styles.mapTrail}
                  viewBox="0 0 1000 560"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M130 160 C245 45 330 65 430 115 S660 80 770 160 S670 285 570 300 S365 275 230 355 S395 468 470 475" />
                  <circle cx="130" cy="160" r="5" />
                  <circle cx="430" cy="115" r="5" />
                  <circle cx="770" cy="160" r="5" />
                  <circle cx="230" cy="355" r="5" />
                  <circle cx="570" cy="300" r="5" />
                  <circle cx="830" cy="350" r="5" />
                  <circle cx="470" cy="475" r="5" />
                </svg>
                <span className={`${styles.mapCloud} ${styles.mapCloudOne}`} aria-hidden="true" />
                <span className={`${styles.mapCloud} ${styles.mapCloudTwo}`} aria-hidden="true" />
                {reasonTotals.map(({ reason, label, x, y, errors }) => {
                  const difficulty = getDifficulty(errors, maximumReasonErrors);
                  const isSelected = activeReason.reason === reason;
                  return (
                    <button
                      type="button"
                      key={reason}
                      className={`${styles.topicIsland} ${styles[difficulty]} ${isSelected ? styles.selectedIsland : ''}`}
                      style={{ left: `${x}%`, top: `${y}%` }}
                      onClick={() => setSelectedReason(reason)}
                      aria-pressed={isSelected}
                      aria-label={`${label}: ${errors} errores, ${getDifficultyLabel(difficulty)}. Abrir detalle`}
                    >
                      <span className={styles.topicSign}>
                        <strong>{label}</strong>
                        <span>
                          {difficulty === 'calm' ? <Leaf size={13} /> : <AlertTriangle size={13} />}
                          {getDifficultyLabel(difficulty)}
                        </span>
                        <b>
                          {errors} <small>errores</small>
                        </b>
                      </span>
                      <FloatingIsland className={styles.mapIslandArt} top={47} />
                      <span className={styles.mapPin} aria-hidden="true" />
                    </button>
                  );
                })}
                <div className={styles.mapGround} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>

              <aside className={styles.topicNotes} aria-live="polite" aria-labelledby="topic-note-title">
                <div className={styles.noteHeading}>
                  <span className={styles.notePin}>
                    <MapPin size={17} />
                  </span>
                  <div>
                    <span className={styles.eyebrow}>REGISTRO DE CAMPO</span>
                    <h3 id="topic-note-title">{activeReason.label}</h3>
                    <span className={`${styles.topicCondition} ${styles[reasonDifficulty]}`}>
                      {getDifficultyLabel(reasonDifficulty)}
                    </span>
                  </div>
                  <strong className={styles.noteErrors}>
                    {activeReason.errors}
                    <small> errores</small>
                  </strong>
                </div>
                <div className={styles.noteColumns}>
                  <p className={styles.frequencyText}>
                    <span>Frecuencia en los errores del grupo</span>
                    <strong>{reasonFrequency}%</strong>
                  </p>
                  <div className={styles.noteList}>
                    <strong>Aprendices que necesitan apoyo</strong>
                    {attentionStudents.length === 0 ? (
                      <span>Ningún aprendiz marcado por ahora.</span>
                    ) : (
                      attentionStudents.map((item) => (
                        <span key={item.student.id}>
                          {item.student.displayName}
                          <b>{formatPercent(item.accuracyPercent)}</b>
                        </span>
                      ))
                    )}
                  </div>
                  <div className={styles.noteList}>
                    <strong>
                      {activeReason.reason === 'RULE_VIOLATION' ? 'Reglas a practicar' : 'Retos a reforzar'}
                    </strong>
                    {practiceItems.length === 0 ? (
                      <span>Sin elementos para reforzar.</span>
                    ) : (
                      practiceItems.map((item) => (
                        <span key={item.key}>
                          {item.label}
                          <b>{item.count}</b>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </aside>
            </section>

            <section className={styles.explorersSection} aria-labelledby="explorers-title">
              <div className={styles.explorersHeading}>
                <span className={styles.eyebrow}>
                  <Sprout size={14} /> CAMINOS PERSONALES
                </span>
                <h2 id="explorers-title">Recorridos de aprendizaje</h2>
                <p>Elige un aprendiz para explorar sus avances y próximos pasos.</p>
              </div>

              {students.length === 0 ? (
                <p className={styles.emptyState}>Este grupo todavía no tiene estudiantes.</p>
              ) : (
                <div className={styles.explorerLayout}>
                  <nav className={styles.explorerList} aria-label="Aprendices del grupo">
                    {sortedStudents.map((student) => {
                      const status = getStatus(student);
                      return (
                        <button
                          type="button"
                          key={student.student.id}
                          className={`${styles.explorer} ${selectedId === student.student.id ? styles.selectedExplorer : ''}`}
                          onClick={() => selectStudent(student.student.id)}
                          aria-pressed={selectedId === student.student.id}
                        >
                          <span className={styles.explorerInitial}>
                            {student.student.displayName.charAt(0)}
                          </span>
                          <span className={styles.explorerInfo}>
                            <strong>{student.student.displayName}</strong>
                            <small>
                              {errorsOf(student)} errores · {formatPercent(student.totals.accuracyPercent)}
                            </small>
                          </span>
                          <span className={`${styles.statusWord} ${styles[status]}`}>
                            {statusLabels[status]}
                          </span>
                        </button>
                      );
                    })}
                  </nav>

                  {selectedStudent && (
                    <article className={styles.journey} aria-labelledby="student-journey-title">
                      <div className={styles.journeyHeader}>
                        <img src={grasshopperIdle} alt="" />
                        <div>
                          <span className={styles.eyebrow}>AVENTURA INDIVIDUAL</span>
                          <h3 id="student-journey-title">{selectedStudent.student.displayName}</h3>
                        </div>
                        <span className={`${styles.statusWord} ${styles[studentStatus]}`}>
                          {statusLabels[studentStatus]}
                        </span>
                      </div>

                      <div className={styles.journeyStats}>
                        <span>
                          <b>{selectedStudent.totals.correct + errorsOf(selectedStudent)}</b> preguntas
                        </span>
                        <span>
                          <b className={styles.rightAnswer}>{selectedStudent.totals.correct}</b> aciertos
                        </span>
                        <span>
                          <b className={styles.missedAnswer}>{errorsOf(selectedStudent)}</b> errores
                        </span>
                        <span>
                          <b>{formatPercent(selectedStudent.totals.accuracyPercent)}</b> precisión
                        </span>
                      </div>

                      {detailError && (
                        <p className={styles.emptyState} role="alert">
                          {detailError}
                        </p>
                      )}
                      {!detail && !detailError && (
                        <p className={styles.emptyState} role="status">
                          Cargando recorrido…
                        </p>
                      )}

                      {detail && (
                        <>
                          <LearningTrail
                            history={getAccuracyHistory(detail.attempts)}
                            attemptCount={
                              detail.attempts.filter((attempt) => attempt.outcome !== 'PENDING').length
                            }
                          />

                          <div className={styles.learningTopics}>
                            <div className={styles.mastered}>
                              <h4>
                                <Check size={14} /> Islas dominadas
                              </h4>
                              <div>
                                {masteredChallenges.length === 0 ? (
                                  <span className={styles.noTopic}>
                                    Aún no hay retos resueltos sin errores.
                                  </span>
                                ) : (
                                  masteredChallenges.map((challenge) => (
                                    <span key={challenge.key}>{challenge.label}</span>
                                  ))
                                )}
                              </div>
                            </div>
                            <div className={styles.needsPractice}>
                              <h4>
                                <AlertTriangle size={14} /> Próximos pasos
                              </h4>
                              <div>
                                {reinforcement.length === 0 ? (
                                  <span className={styles.noTopic}>Sin errores registrados.</span>
                                ) : (
                                  reinforcement.map((item) => (
                                    <span key={item.key}>
                                      {item.label}
                                      <b>{item.count}</b>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                          <p className={styles.demoFootnote}>
                            El recorrido usa los intentos más recientes registrados en el juego.
                          </p>
                        </>
                      )}
                    </article>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
