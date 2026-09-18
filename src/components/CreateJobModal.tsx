import React, { useState } from 'react';
import { X, PlusCircle, Wand2, Mic } from 'lucide-react';
import type { JobStatus } from '../types.js';

interface CreateJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated: () => void;
}

export function CreateJobModal({ isOpen, onClose, onJobCreated }: CreateJobModalProps) {
  const [chatId, setChatId] = useState('-1001984729104');
  const [messageId, setMessageId] = useState(String(Math.floor(1000 + Math.random() * 9000)));
  const [senderUserId, setSenderUserId] = useState('user_' + Math.floor(10000 + Math.random() * 90000));
  const [originalFileId, setOriginalFileId] = useState('AwACAgIAAxkBA' + Math.random().toString(36).substring(2, 10));
  const [localFilePath, setLocalFilePath] = useState(`/tmp/voice_${Date.now()}.ogg`);
  const [status, setStatus] = useState<JobStatus>('pending');
  const [transcription, setTranscription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRandomize = () => {
    setMessageId(String(Math.floor(1000 + Math.random() * 9000)));
    setSenderUserId('user_' + Math.floor(10000 + Math.random() * 90000));
    setOriginalFileId('AwACAgIAAxkBA' + Math.random().toString(36).substring(2, 10));
    setLocalFilePath(`/tmp/voice_${Date.now()}.ogg`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/jobs/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_chat_id: chatId,
          telegram_message_id: Number(messageId),
          sender_user_id: senderUserId,
          original_file_id: originalFileId,
          local_file_path: localFilePath,
          status,
          transcription: transcription || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create job');
      }

      onJobCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating test job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Mic className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Add Test Voice Job</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleRandomize}
              className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium cursor-pointer"
            >
              <Wand2 className="w-3 h-3" />
              Randomize values
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Telegram Chat ID</label>
              <input
                type="text"
                required
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Message ID</label>
              <input
                type="number"
                required
                value={messageId}
                onChange={(e) => setMessageId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Sender User ID</label>
              <input
                type="text"
                required
                value={senderUserId}
                onChange={(e) => setSenderUserId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as JobStatus)}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
              >
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="waiting_transcription">Waiting Transcription</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Local Audio Path (.ogg)</label>
            <input
              type="text"
              required
              value={localFilePath}
              onChange={(e) => setLocalFilePath(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
            />
          </div>

          {status === 'completed' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Transcription Text</label>
              <textarea
                rows={2}
                value={transcription}
                onChange={(e) => setTranscription(e.target.value)}
                placeholder="Текст расшифровки..."
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium rounded-lg cursor-pointer transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{submitting ? 'Creating...' : 'Create Job'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
