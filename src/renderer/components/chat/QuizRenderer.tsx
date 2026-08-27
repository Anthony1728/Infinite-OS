import { useState, useCallback } from 'react';

interface QuizOption {
  label: string;
  text: string;
  isCorrect: boolean;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: QuizOption[];
  explanation?: string;
}

interface QuizData {
  quizId: string;
  title: string;
  description?: string;
  questions: QuizQuestion[];
}

interface QuizRendererProps {
  quiz: QuizData;
  onComplete?: (results: QuizResults) => void;
}

export interface QuizResults {
  quizId: string;
  title: string;
  totalQuestions: number;
  correctAnswers: number;
  answers: Array<{ questionId: string; selected: string; correct: boolean }>;
}

type QuizState = 'intro' | 'active' | 'results';

export function QuizRenderer({ quiz, onComplete }: QuizRendererProps) {
  const [state, setState] = useState<QuizState>('intro');
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<Array<{ questionId: string; selected: string; correct: boolean }>>([]);

  const question = quiz.questions[currentQ];
  const total = quiz.questions.length;
  const progress = ((currentQ + (revealed ? 1 : 0)) / total) * 100;
  const correctCount = answers.filter((a) => a.correct).length;

  const handleSelect = useCallback((opt: QuizOption) => {
    if (revealed) return;
    setSelected(opt.label);
    setRevealed(true);
    setAnswers((prev) => [
      ...prev,
      { questionId: question.id, selected: opt.label, correct: opt.isCorrect },
    ]);
  }, [revealed, question?.id]);

  const handleNext = useCallback(() => {
    if (currentQ + 1 < total) {
      setCurrentQ((c) => c + 1);
      setSelected(null);
      setRevealed(false);
    } else {
      const results: QuizResults = {
        quizId: quiz.quizId,
        title: quiz.title,
        totalQuestions: total,
        correctAnswers: correctCount + (answers.length > 0 && answers[answers.length - 1]?.correct ? 0 : selected !== null && revealed ? 1 : 0),
        answers: answers,
      };
      // Recount correctly
      results.correctAnswers = results.answers.filter((a) => a.correct).length;
      setState('results');
      onComplete?.(results);
    }
  }, [currentQ, total, answers, onComplete, quiz, selected, revealed, correctCount]);

  const restart = () => {
    setState('intro');
    setCurrentQ(0);
    setSelected(null);
    setRevealed(false);
    setAnswers([]);
  };

  if (state === 'intro') {
    return (
      <div className="quiz-container">
        <div className="quiz-intro">
          <div className="quiz-intro-icon">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="url(#quizGrad)" strokeWidth="1.5">
              <defs>
                <linearGradient id="quizGrad" x1="4" y1="4" x2="20" y2="20">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>
              </defs>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
          </div>
          <h3 className="quiz-title">{quiz.title}</h3>
          {quiz.description && <p className="quiz-description">{quiz.description}</p>}
          <div className="quiz-meta">
            <span className="quiz-meta-item">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
              {total} question{total !== 1 ? 's' : ''}
            </span>
            <span className="quiz-meta-item">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              ~{Math.ceil(total * 0.5)} min
            </span>
          </div>
          <button className="quiz-start-btn" onClick={() => setState('active')}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
            Start Quiz
          </button>
        </div>
      </div>
    );
  }

  if (state === 'results') {
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const grade =
      pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
    return (
      <div className="quiz-container">
        <div className="quiz-results">
          <div className="quiz-results-score-ring">
            <svg viewBox="0 0 120 120" className="w-28 h-28">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="url(#resultGrad)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 326.7} 326.7`}
                transform="rotate(-90 60 60)"
                className="quiz-score-arc"
              />
              <defs>
                <linearGradient id="resultGrad" x1="0" y1="0" x2="120" y2="120">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="50%" stopColor="#22d3ee" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
            </svg>
            <div className="quiz-results-score-text">
              <span className="quiz-results-pct">{pct}%</span>
              <span className="quiz-results-grade">{grade}</span>
            </div>
          </div>
          <h3 className="quiz-results-title">Quiz Complete</h3>
          <p className="quiz-results-subtitle">
            {correctCount} of {total} correct
          </p>
          <div className="quiz-results-breakdown">
            {answers.map((a, i) => {
              const q = quiz.questions[i];
              return (
                <div key={a.questionId} className={`quiz-result-row ${a.correct ? 'correct' : 'incorrect'}`}>
                  <span className="quiz-result-indicator">
                    {a.correct ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </span>
                  <span className="quiz-result-q">{q.question}</span>
                  {!a.correct && (
                    <span className="quiz-result-correct">
                      Answer: {q.options.find((o) => o.isCorrect)?.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="quiz-results-actions">
            <button className="quiz-restart-btn" onClick={restart}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Retry Quiz
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-container">
      <div className="quiz-header">
        <div className="quiz-progress-bar">
          <div className="quiz-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="quiz-progress-info">
          <span className="quiz-progress-label">
            Question {currentQ + 1} of {total}
          </span>
          <span className="quiz-progress-score">
            {correctCount} correct
          </span>
        </div>
      </div>
      <div className="quiz-question-area">
        <p className="quiz-question-text">{question.question}</p>
        <div className="quiz-options">
          {question.options.map((opt) => {
            let optClass = 'quiz-option';
            if (revealed) {
              if (opt.isCorrect) optClass += ' correct';
              else if (opt.label === selected) optClass += ' incorrect';
              else optClass += ' dimmed';
            } else if (opt.label === selected) {
              optClass += ' selected';
            }
            return (
              <button key={opt.label} className={optClass} onClick={() => handleSelect(opt)}>
                <span className="quiz-option-label">{opt.label}</span>
                <span className="quiz-option-text">{opt.text}</span>
                {revealed && opt.isCorrect && (
                  <span className="quiz-option-check">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </span>
                )}
                {revealed && opt.label === selected && !opt.isCorrect && (
                  <span className="quiz-option-x">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {revealed && question.explanation && (
          <div className="quiz-explanation">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
            <p>{question.explanation}</p>
          </div>
        )}
        {revealed && (
          <button className="quiz-next-btn" onClick={handleNext}>
            {currentQ + 1 < total ? (
              <>
                Next Question
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </>
            ) : (
              <>
                See Results
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
