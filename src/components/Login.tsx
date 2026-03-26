import React, { useEffect, useState } from 'react';
import { Mic, ArrowRight, User, Mail, Lock } from 'lucide-react';
import { loginWithPassword, registerWithPassword } from '../api';
import type { AuthUser } from '../types';

export function Login({
  onLogin,
  allowRegistration,
}: {
  onLogin: (user: AuthUser) => void;
  allowRegistration: boolean;
}) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowRegistration && isRegister) {
      setIsRegister(false);
      setError('Self-service registration is disabled.');
    }
  }, [allowRegistration, isRegister]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister && !allowRegistration) {
      setError('Self-service registration is disabled.');
      return;
    }
    if (!email || !password || (isRegister && !name)) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const user = isRegister
        ? await registerWithPassword({ name, email, password })
        : await loginWithPassword({ email, password });
      onLogin(user);
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col justify-center items-center p-4 font-sans">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="p-8 pb-6 bg-indigo-600 text-white text-center">
          <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
            <Mic className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">AudioSense AI</h1>
          <p className="text-indigo-100 text-sm">Audio workspace with auth, queue, and AI analysis</p>
        </div>

        <div className="p-8">
          <h2 className="text-xl font-semibold text-slate-800 mb-6 text-center">
            {isRegister ? 'Create your workspace account' : 'Welcome back'}
          </h2>

          {!allowRegistration && (
            <div className="mb-4 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              Self-service registration is disabled. Sign in with an existing account.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 ml-1">Name</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="block w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                    placeholder="John Doe"
                    required={isRegister}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 ml-1">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 ml-1">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </div>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3.5 px-4 rounded-xl font-medium text-base transition-all shadow-md hover:shadow-lg active:scale-[0.98] mt-6 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Please wait...' : isRegister ? 'Sign Up' : 'Sign In'}
              <ArrowRight className="w-5 h-5" />
            </button>
          </form>

          <div className="mt-8 text-center">
            {allowRegistration ? (
              <p className="text-sm text-slate-500">
                {isRegister ? 'Already have an account?' : "Don't have an account?"}
                <button
                  onClick={() => {
                    setIsRegister(!isRegister);
                    setError('');
                  }}
                  className="ml-1.5 text-indigo-600 font-semibold hover:text-indigo-700 hover:underline"
                >
                  {isRegister ? 'Sign In' : 'Sign Up'}
                </button>
              </p>
            ) : (
              <p className="text-sm text-slate-500">Ask your administrator to create an account for you.</p>
            )}
          </div>
        </div>
      </div>

      <p className="mt-8 text-xs text-slate-400 text-center max-w-xs">
        Sessions are now stored server-side via secure HTTP-only cookies instead of mock local login.
      </p>
    </div>
  );
}
