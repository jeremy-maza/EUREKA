import { useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Compass, Leaf, MapPin, Sprout } from 'lucide-react'
import grasshopperIdle from '@/assets/grillo/grillo1.png'
import { FloatingIsland } from '@/features/game/components/FloatingIsland'
import { InsightsHeader } from '@/shared/components/InsightsHeader'
import {
  demoTeacherStudents,
  difficultyTopics,
  getStudentAccuracy,
  getStudentErrorCount,
  getStudentStatus,
  type DemoStudent,
} from '@/features/teacher/data/demoTeacherData'
import styles from './TeacherDashboardPage.module.css'

type StudentStatus = ReturnType<typeof getStudentStatus>
type TopicName = typeof difficultyTopics[number]

const topicLocations: { topic: TopicName; x: number; y: number }[] = [
  { topic: 'Sumas', x: 13, y: 13 },
  { topic: 'Restas', x: 43, y: 5 },
  { topic: 'Multiplicaciones', x: 77, y: 13 },
  { topic: 'Divisiones', x: 23, y: 45 },
  { topic: 'Fracciones', x: 57, y: 41 },
  { topic: 'Números negativos', x: 83, y: 49 },
  { topic: 'Operaciones combinadas', x: 47, y: 68 },
]

const topicOperationMatchers: Record<TopicName, RegExp> = {
  Sumas: /suma/i,
  Restas: /resta/i,
  Multiplicaciones: /multiplicación/i,
  Divisiones: /división/i,
  Fracciones: /fracciones/i,
  'Números negativos': /negativos/i,
  'Operaciones combinadas': /combinadas/i,
}

const statusLabels: Record<StudentStatus, string> = {
  support: 'Necesita apoyo',
  watch: 'En observación',
  good: 'Buen rendimiento',
}

const statusOrder: Record<StudentStatus, number> = { support: 0, watch: 1, good: 2 }

function getGroupMetrics() {
  const topicTotals = difficultyTopics.map((topic) => ({
    topic,
    errors: demoTeacherStudents.reduce((total, student) => total + (student.topicErrors[topic] ?? 0), 0),
  }))
  const totalCorrect = demoTeacherStudents.reduce((total, student) => total + student.correctAnswers, 0)
  const totalIncorrect = demoTeacherStudents.reduce((total, student) => total + student.incorrectAnswers, 0)
  const studentsNeedingAttention = demoTeacherStudents.filter((student) => getStudentStatus(student) !== 'good').length

  return {
    topicTotals,
    totalCorrect,
    totalIncorrect,
    studentsNeedingAttention,
    overallAccuracy: Math.round((totalCorrect / (totalCorrect + totalIncorrect)) * 100),
  }
}

function getDifficulty(errors: number, maximum: number) {
  if (errors === 0 || errors / maximum < 0.3) return 'calm' as const
  if (errors / maximum < 0.65) return 'watch' as const
  return 'high' as const
}

function getDifficultyLabel(level: ReturnType<typeof getDifficulty>) {
  if (level === 'high') return 'Refuerzo prioritario'
  if (level === 'watch') return 'Conviene practicar'
  return 'Buen dominio'
}

function LearningTrail({ student }: { student: DemoStudent }) {
  const points = student.accuracyHistory
    .map((accuracy, index) => `${20 + index * 70},${75 - accuracy * 0.58}`)
    .join(' ')
  const current = student.accuracyHistory[student.accuracyHistory.length - 1]
  const previous = student.accuracyHistory[student.accuracyHistory.length - 2]
  const improved = current >= previous

  return (
    <div className={styles.learningTrail}>
      <div className={styles.trailHeading}>
        <span><Compass size={14} /> Recorrido de precisión</span>
        <strong className={improved ? styles.trendUp : styles.trendDown}>
          {improved ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {current - previous > 0 ? '+' : ''}{current - previous} pts
        </strong>
      </div>
      <svg viewBox="0 0 320 88" role="img" aria-label={`Precisión en cinco etapas: ${student.accuracyHistory.join(', ')} por ciento`}>
        <polyline points={points} className={styles.trailPath} />
        {student.accuracyHistory.map((accuracy, index) => {
          const x = 20 + index * 70
          const y = 75 - accuracy * 0.58
          return (
            <g key={`${accuracy}-${index}`}>
              <circle cx={x} cy={y} r="9" className={index === student.accuracyHistory.length - 1 ? styles.currentTrailPoint : styles.trailPoint} />
              <text x={x} y={y + 3} textAnchor="middle" className={styles.trailPointLabel}>{index + 1}</text>
            </g>
          )
        })}
      </svg>
      <div className={styles.trailLabels}><span>Primera etapa</span><span>Actual · {current}%</span></div>
    </div>
  )
}

export function TeacherDashboardPage() {
  const [selectedId, setSelectedId] = useState(demoTeacherStudents[0].id)
  const [selectedTopic, setSelectedTopic] = useState<TopicName>('Divisiones')
  const metrics = getGroupMetrics()
  const selectedStudent = demoTeacherStudents.find((student) => student.id === selectedId) ?? demoTeacherStudents[0]
  const sortedStudents = [...demoTeacherStudents].sort((a, b) => {
    const statusDifference = statusOrder[getStudentStatus(a)] - statusOrder[getStudentStatus(b)]
    return statusDifference || getStudentErrorCount(b) - getStudentErrorCount(a)
  })
  const maximumTopicErrors = Math.max(...metrics.topicTotals.map(({ errors }) => errors), 1)
  const selectedTopicErrors = demoTeacherStudents.reduce(
    (total, student) => total + (student.topicErrors[selectedTopic] ?? 0),
    0,
  )
  const topicFrequency = metrics.totalIncorrect === 0
    ? 0
    : Math.round((selectedTopicErrors / metrics.totalIncorrect) * 100)
  const studentsByTopic = demoTeacherStudents
    .map((student) => ({ student, errors: student.topicErrors[selectedTopic] ?? 0 }))
    .filter(({ errors }) => errors > 0)
    .sort((a, b) => b.errors - a.errors)
  const operationsByTopic = new Map<string, number>()

  for (const student of demoTeacherStudents) {
    for (const operation of student.operationErrors) {
      if (topicOperationMatchers[selectedTopic].test(operation.label)) {
        operationsByTopic.set(
          operation.label,
          (operationsByTopic.get(operation.label) ?? 0) + operation.count,
        )
      }
    }
  }

  const topOperations = [...operationsByTopic.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const selectedTopicDifficulty = getDifficulty(selectedTopicErrors, maximumTopicErrors)
  const masteredTopics = difficultyTopics.filter((topic) => (selectedStudent.topicErrors[topic] ?? 0) === 0)
  const reinforcementTopics = difficultyTopics
    .map((topic) => ({ topic, errors: selectedStudent.topicErrors[topic] ?? 0 }))
    .filter(({ errors }) => errors > 0)
    .sort((a, b) => b.errors - a.errors)
  const accuracy = getStudentAccuracy(selectedStudent)
  const studentStatus = getStudentStatus(selectedStudent)

  return (
    <main className={styles.page}>
      <InsightsHeader activePage="teacher" />
      <div className={styles.content}>
        <header className={styles.intro}>
          <div>
            <span className={styles.eyebrow}><Compass size={14} /> MAPA DEL BOSQUE NUMÉRICO</span>
            <h1>Mapa de conocimientos</h1>
            <p>Explora las islas y descubre dónde acompañar el próximo aprendizaje.</p>
          </div>
          <div className={styles.demoSign}>
            <span>MUESTRA DE EXPLORACIÓN</span>
            <strong>Datos ficticios · no son resultados reales</strong>
          </div>
        </header>

        <div className={styles.groupTrail} aria-label="Resumen de demostración">
          <span><i className={styles.groupMarker} />{demoTeacherStudents.length} aprendices</span>
          <span><i className={styles.errorMarker} />{metrics.totalIncorrect} errores revisados</span>
          <span><i className={styles.accuracyMarker} />{metrics.overallAccuracy}% precisión de muestra</span>
        </div>

        <section className={styles.mapSection} aria-labelledby="map-title">
          <div className={styles.mapHeading}>
            <div>
              <span className={styles.eyebrow}>RECORRIDO DEL GRUPO</span>
              <h2 id="map-title">Islas de aprendizaje</h2>
            </div>
            <span className={styles.mapHint}>Selecciona una isla para inspeccionar sus huellas</span>
          </div>

          <div className={styles.mapArea}>
            <svg className={styles.mapTrail} viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
              <path d="M130 160 C245 45 330 65 430 115 S660 80 770 160 S670 285 570 300 S365 275 230 355 S395 468 470 475" />
              <circle cx="130" cy="160" r="5" /><circle cx="430" cy="115" r="5" />
              <circle cx="770" cy="160" r="5" /><circle cx="230" cy="355" r="5" />
              <circle cx="570" cy="300" r="5" /><circle cx="830" cy="350" r="5" />
              <circle cx="470" cy="475" r="5" />
            </svg>
            <span className={`${styles.mapCloud} ${styles.mapCloudOne}`} aria-hidden="true" />
            <span className={`${styles.mapCloud} ${styles.mapCloudTwo}`} aria-hidden="true" />
            {topicLocations.map(({ topic, x, y }) => {
              const errors = metrics.topicTotals.find((item) => item.topic === topic)?.errors ?? 0
              const difficulty = getDifficulty(errors, maximumTopicErrors)
              const isSelected = selectedTopic === topic
              return (
                <button
                  type="button"
                  key={topic}
                  className={`${styles.topicIsland} ${styles[difficulty]} ${isSelected ? styles.selectedIsland : ''}`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  onClick={() => setSelectedTopic(topic)}
                  aria-pressed={isSelected}
                  aria-label={`${topic}: ${errors} errores, ${getDifficultyLabel(difficulty)}. Abrir detalle`}
                >
                  <span className={styles.topicSign}>
                    <strong>{topic}</strong>
                    <span>{difficulty === 'calm' ? <Leaf size={13} /> : <AlertTriangle size={13} />}{getDifficultyLabel(difficulty)}</span>
                    <b>{errors} <small>errores</small></b>
                  </span>
                  <FloatingIsland className={styles.mapIslandArt} top={47} />
                  <span className={styles.mapPin} aria-hidden="true" />
                </button>
              )
            })}
            <div className={styles.mapGround} aria-hidden="true"><span /><span /><span /><span /><span /></div>
          </div>

          <aside className={styles.topicNotes} aria-live="polite" aria-labelledby="topic-note-title">
            <div className={styles.noteHeading}>
              <span className={styles.notePin}><MapPin size={17} /></span>
              <div>
                <span className={styles.eyebrow}>REGISTRO DE CAMPO · DEMO</span>
                <h3 id="topic-note-title">{selectedTopic}</h3>
                <span className={`${styles.topicCondition} ${styles[selectedTopicDifficulty]}`}>
                  {getDifficultyLabel(selectedTopicDifficulty)}
                </span>
              </div>
              <strong className={styles.noteErrors}>{selectedTopicErrors}<small> errores</small></strong>
            </div>
            <div className={styles.noteColumns}>
              <p className={styles.frequencyText}>
                <span>Frecuencia en los errores del grupo</span>
                <strong>{topicFrequency}%</strong>
              </p>
              <div className={styles.noteList}>
                <strong>Aprendices con más tropiezos</strong>
                {studentsByTopic.length === 0
                  ? <span>Sin errores registrados en esta muestra.</span>
                  : studentsByTopic.slice(0, 3).map(({ student, errors }) => (
                    <span key={student.id}>{student.name}<b>{errors}</b></span>
                  ))}
              </div>
              <div className={styles.noteList}>
                <strong>Operaciones a practicar</strong>
                {topOperations.length === 0
                  ? <span>Sin operaciones asociadas.</span>
                  : topOperations.map(([operation, count]) => (
                    <span key={operation}>{operation}<b>{count}</b></span>
                  ))}
              </div>
            </div>
          </aside>
        </section>

        <section className={styles.explorersSection} aria-labelledby="explorers-title">
          <div className={styles.explorersHeading}>
            <span className={styles.eyebrow}><Sprout size={14} /> CAMINOS PERSONALES</span>
            <h2 id="explorers-title">Recorridos de aprendizaje</h2>
            <p>Elige un aprendiz para explorar sus avances y próximos pasos.</p>
          </div>

          <div className={styles.explorerLayout}>
            <nav className={styles.explorerList} aria-label="Aprendices de demostración">
              {sortedStudents.map((student) => {
                const status = getStudentStatus(student)
                return (
                  <button
                    type="button"
                    key={student.id}
                    className={`${styles.explorer} ${selectedStudent.id === student.id ? styles.selectedExplorer : ''}`}
                    onClick={() => setSelectedId(student.id)}
                    aria-pressed={selectedStudent.id === student.id}
                  >
                    <span className={styles.explorerInitial}>{student.name.charAt(0)}</span>
                    <span className={styles.explorerInfo}>
                      <strong>{student.name}</strong>
                      <small>{getStudentErrorCount(student)} errores · {getStudentAccuracy(student)}%</small>
                    </span>
                    <span className={`${styles.statusWord} ${styles[status]}`}>{statusLabels[status]}</span>
                  </button>
                )
              })}
            </nav>

            <article className={styles.journey} aria-labelledby="student-journey-title">
              <div className={styles.journeyHeader}>
                <img src={grasshopperIdle} alt="" />
                <div>
                  <span className={styles.eyebrow}>AVENTURA INDIVIDUAL · DEMO</span>
                  <h3 id="student-journey-title">{selectedStudent.name}</h3>
                </div>
                <span className={`${styles.statusWord} ${styles[studentStatus]}`}>{statusLabels[studentStatus]}</span>
              </div>

              <div className={styles.journeyStats}>
                <span><b>{selectedStudent.correctAnswers + selectedStudent.incorrectAnswers}</b> preguntas</span>
                <span><b className={styles.rightAnswer}>{selectedStudent.correctAnswers}</b> aciertos</span>
                <span><b className={styles.missedAnswer}>{selectedStudent.incorrectAnswers}</b> errores</span>
                <span><b>{accuracy}%</b> precisión</span>
              </div>

              <LearningTrail student={selectedStudent} />

              <div className={styles.learningTopics}>
                <div className={styles.mastered}>
                  <h4><Check size={14} /> Islas dominadas</h4>
                  <div>
                    {masteredTopics.length === 0
                      ? <span className={styles.noTopic}>Aún no hay temas sin errores en la muestra.</span>
                      : masteredTopics.map((topic) => <span key={topic}>{topic}</span>)}
                  </div>
                </div>
                <div className={styles.needsPractice}>
                  <h4><AlertTriangle size={14} /> Próximos pasos</h4>
                  <div>
                    {reinforcementTopics.map(({ topic, errors }) => (
                      <span key={topic}>{topic}<b>{errors}</b></span>
                    ))}
                  </div>
                </div>
              </div>
              <p className={styles.demoFootnote}>Este recorrido es una muestra ficticia y no representa el progreso real de una persona.</p>
            </article>
          </div>
        </section>
      </div>
    </main>
  )
}
