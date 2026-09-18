import { useState, useEffect, useCallback } from 'react';
import {
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  Smartphone,
  Lock,
  Copy,
  Check,
  Eye,
  EyeOff,
  MessageSquare,
} from 'lucide-react';

interface MTProtoStatusResponse {
  success: boolean;
  isConfigured: boolean;
  apiId: number;
  hasApiHash: boolean;
  phoneNumber?: string;
  isAuthorized: boolean;
  hasSession: boolean;
  sessionPreview?: string;
  targetBot: string;
  pendingStep: 'idle' | 'waiting_code' | 'waiting_password';
  isCodeViaApp?: boolean;
  error?: string;
}

interface TelegramAuthCardProps {
  onAuthSuccess?: () => void;
}

export function TelegramAuthCard({ onAuthSuccess }: TelegramAuthCardProps) {
  const [status, setStatus] = useState<MTProtoStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Form states
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Action states
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState<'idle' | 'code' | 'password' | 'success'>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedSession, setSavedSession] = useState<string | null>(null);
  const [copiedSession, setCopiedSession] = useState(false);

  // Load status from backend
  const fetchAuthStatus = useCallback(async () => {
    setLoadingStatus(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/telegram/auth/status');
      const data: MTProtoStatusResponse = await res.json();
      if (res.ok && data.success) {
        setStatus(data);
        if (data.phoneNumber && !phoneNumber) {
          setPhoneNumber(data.phoneNumber);
        }
        if (data.isAuthorized) {
          setCurrentStep('success');
        } else if (data.pendingStep === 'waiting_code') {
          setCurrentStep('code');
        } else if (data.pendingStep === 'waiting_password') {
          setCurrentStep('password');
        }
      } else {
        setErrorMessage(data.error || 'Не удалось загрузить статус MTProto');
      }
    } catch {
      setErrorMessage('Ошибка соединения с сервером');
    } finally {
      setLoadingStatus(false);
    }
  }, [phoneNumber]);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  // Step 1: Start Auth (send code)
  const handleStartAuth = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/telegram/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        if (data.step === 'already_authorized') {
          setCurrentStep('success');
          setStatusMessage('MTProto клиент уже авторизован!');
          fetchAuthStatus();
          onAuthSuccess?.();
        } else {
          setCurrentStep('code');
          setStatusMessage(data.message || 'Код подтверждения отправлен в Telegram');
        }
      } else {
        setErrorMessage(data.error || 'Ошибка при отправке запроса авторизации');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Сетевая ошибка при запросе кода');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2: Submit Code
  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setErrorMessage('Введите код из Telegram');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/telegram/auth/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        if (data.step === 'waiting_password') {
          setCurrentStep('password');
          setStatusMessage(data.message || 'Требуется ввод пароля двухфакторной аутентификации (2FA)');
        } else {
          setCurrentStep('success');
          setSavedSession(data.sessionString || null);
          setStatusMessage(data.message || 'Авторизация успешно завершена! TELEGRAM_SESSION сохранён.');
          fetchAuthStatus();
          onAuthSuccess?.();
        }
      } else {
        setErrorMessage(data.error || 'Неверный код Telegram');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Ошибка отправки кода');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3: Submit 2FA Password
  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMessage('Введите 2FA пароль');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/telegram/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCurrentStep('success');
        setSavedSession(data.sessionString || null);
        setStatusMessage(data.message || '2FA пройдена! TELEGRAM_SESSION успешно сохранён.');
        fetchAuthStatus();
        onAuthSuccess?.();
      } else {
        setErrorMessage(data.error || 'Неверный 2FA пароль');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Ошибка проверки пароля 2FA');
    } finally {
      setSubmitting(false);
    }
  };

  // Reset auth flow
  const handleReset = async () => {
    try {
      await fetch('/api/telegram/auth/reset', { method: 'POST' });
    } catch {
      // ignore
    }
    setCode('');
    setPassword('');
    setErrorMessage(null);
    setStatusMessage(null);
    setCurrentStep('idle');
    fetchAuthStatus();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSession(true);
    setTimeout(() => setCopiedSession(false), 2500);
  };

  return (
    <div id="telegram-mtproto-auth-card" className="space-y-6">
      {/* Top Status Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Авторизация Telegram MTProto
              </h2>
              <p className="text-xs text-slate-500">
                Для работы с @speech_transcriber_bot и голосовыми сообщениями в AI Studio
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="refresh-auth-status-button"
              onClick={fetchAuthStatus}
              disabled={loadingStatus}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
              <span>Обновить статус</span>
            </button>

            {status?.isAuthorized ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Авторизован
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                <AlertCircle className="w-3.5 h-3.5" />
                Требуется вход
              </span>
            )}
          </div>
        </div>

        {/* Configuration Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5">
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200/60">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
              Telegram API ID
            </span>
            <span className="text-xs font-mono font-semibold text-slate-800">
              {status?.apiId || 'Не настроен'}
            </span>
          </div>

          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200/60">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
              Номер телефона
            </span>
            <span className="text-xs font-mono font-semibold text-slate-800">
              {status?.phoneNumber || phoneNumber || 'Не задан'}
            </span>
          </div>

          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200/60">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
              TELEGRAM_SESSION
            </span>
            <span className="text-xs font-mono font-semibold text-slate-800">
              {status?.hasSession ? (
                <span className="text-emerald-600">Сохранена ({status.sessionPreview})</span>
              ) : (
                <span className="text-slate-400">Отсутствует в .env</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{errorMessage}</p>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs flex items-start gap-2.5">
          <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{statusMessage}</p>
          </div>
        </div>
      )}

      {/* Interactive Authorization Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
        <div className="border-b border-slate-100 pb-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Пошаговая форма входа MTProto
          </h3>
          <p className="text-xs text-slate-500">
            Отправка кода прямо из браузера без необходимости ввода через консоль stdin
          </p>
        </div>

        {/* Step 1: Start Authorization */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                currentStep === 'idle'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              1
            </span>
            <label htmlFor="auth-phone-input" className="text-xs font-semibold text-slate-800">
              Шаг 1: Номер телефона и запуск авторизации
            </label>
          </div>

          <form onSubmit={handleStartAuth} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Smartphone className="w-4 h-4" />
              </div>
              <input
                id="auth-phone-input"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+380951456705"
                disabled={submitting || currentStep === 'code' || currentStep === 'password'}
                className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <button
              id="start-auth-button"
              type="submit"
              disabled={submitting || (!phoneNumber && !status?.phoneNumber)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 active:bg-indigo-800 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {submitting && currentStep === 'idle' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Отправка кода...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Начать авторизацию</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Step 2: Code Confirmation */}
        {(currentStep === 'code' || currentStep === 'password' || currentStep === 'success') && (
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  currentStep === 'code'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                2
              </span>
              <label htmlFor="auth-code-input" className="text-xs font-semibold text-slate-800">
                Шаг 2: Код подтверждения из Telegram
              </label>
            </div>

            <p className="text-xs text-slate-500">
              Введите код, который Telegram прислал в личные системные сообщения или SMS.
            </p>

            <form onSubmit={handleSubmitCode} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Key className="w-4 h-4" />
                </div>
                <input
                  id="auth-code-input"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Например: 12345"
                  autoFocus={currentStep === 'code'}
                  disabled={submitting || currentStep !== 'code'}
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono tracking-wider bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>

              {currentStep === 'code' && (
                <button
                  id="submit-code-button"
                  type="submit"
                  disabled={submitting || !code.trim()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 active:bg-emerald-800 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Проверка кода...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Подтвердить код</span>
                    </>
                  )}
                </button>
              )}
            </form>
          </div>
        )}

        {/* Step 3: 2FA Password if needed */}
        {currentStep === 'password' && (
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-amber-500 text-white">
                3
              </span>
              <label htmlFor="auth-password-input" className="text-xs font-semibold text-slate-800">
                Шаг 3: Пароль двухфакторной аутентификации (2FA Cloud Password)
              </label>
            </div>

            <p className="text-xs text-amber-600">
              Ваш аккаунт защищён облачным паролем 2FA. Введите его для завершения входа.
            </p>

            <form onSubmit={handleSubmitPassword} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="auth-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ваш 2FA пароль"
                  autoFocus
                  disabled={submitting}
                  className="w-full pl-9 pr-10 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                id="submit-password-button"
                type="submit"
                disabled={submitting || !password}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 active:bg-amber-800 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Проверка пароля...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Войти с 2FA-паролем</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Step 4: Success Result & StringSession Display */}
        {currentStep === 'success' && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-3">
            <div className="flex items-center gap-2 text-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h4 className="text-xs font-bold">MTProto Авторизация активна</h4>
            </div>

            <p className="text-xs text-emerald-700">
              StringSession сгенерирован и автоматически сохранён в переменную{' '}
              <code className="font-mono font-bold bg-emerald-150 px-1 py-0.5 rounded">
                TELEGRAM_SESSION
              </code>{' '}
              в файле <code>.env</code>.
            </p>

            {(savedSession || status?.sessionPreview) && (
              <div className="bg-white rounded-lg p-3 border border-emerald-200 flex items-center justify-between gap-3">
                <div className="truncate font-mono text-[11px] text-slate-700">
                  {savedSession || status?.sessionPreview}
                </div>
                {savedSession && (
                  <button
                    onClick={() => copyToClipboard(savedSession)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition cursor-pointer shrink-0"
                  >
                    {copiedSession ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-medium">Скопировано</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Копировать</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Action controls (Reset / Change Phone) */}
        {currentStep !== 'idle' && (
          <div className="pt-2 flex justify-end">
            <button
              id="reset-auth-flow-button"
              onClick={handleReset}
              className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
            >
              Сбросить форму и начать заново
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
