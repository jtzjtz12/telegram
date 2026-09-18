import { useState } from 'react';
import { PlusCircle, X, Sparkles } from 'lucide-react';
import type { JobStatus } from '../types.js';

interface CreateJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated: () => void;
}

export function CreateJobModal({ isOpen, onClose, onJobCreated }: CreateJobModalProps) {
  const [chatId, setChatId] = useState('-1001892345678');
  const [messageId, setMessageId] = useState(String(Math.floor(1000 + Math.random() * 9000)));
  const [senderUserId, setSenderUserId] = useState('user_' + Math.floor(10000 + Math.random() * 90000));
  const [fileId, setFileId] = useState('AwACAgIAAxkBA' + Math.random().toString(36).substring(2, 12));
  const [localPath, setLocalPath] = useState(`/tmp/voice_${Date.now()}.ogg`);
  const [status, setStatus] = useState<JobStatus>('pending');
  const [transcription, setTranscription] = useState('');
  const [errorText, setErrorText] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/jobs/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_chat_id: chatId,
          telegram_message_id: parseInt(messageId, 10),
          sender_user_id: senderUserId,
          original_file_id: fileId,
          local_file_path: localPath,
          status,
          transcription: transcription || undefined,
          error: errorText || undefined,
        }),
      });

      if (res.ok) {
        onJobCreated();
        onClose();
      }
    } catch (err) {
      console.error('Failed to create test job', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFillRandom = () => {
    setMessageId(String(Math.floor(1000 + Math.random() * 9000)));
    setSenderUserId('user_' + Math.floor(10000 + Math.random() * 90000));
    setFileId('AwACAgIAAxkBA' + Math.random().toString(36).substring(2, 12));
    setLocalPath(`/tmp/voice_${Date.now()}.ogg`);
  };

  return (
    <div id="create-job-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
        <div className="p-4 sm:px-6 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-indigo-400" />
            <h3 className="font-semibold text-sm">Create Test Voice Job</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleFillRandom}
              className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              Generate random IDs
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-600 mb-1">telegram_chat_id</label>
              <input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                required
                className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 mb-1">telegram_message_id</label>
              <input
                type="number"
                value={messageId}
                onChange={(e) => setMessageId(e.target.value)}
                required
                className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-600 mb-1">sender_user_id</label>
              <input
                type="text"
                value={senderUserId}
                onChange={(e) => setSenderUserId(e.target.value)}
                required
                className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 mb-1">Initial Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as JobStatus)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white focus:ring-1 focus:ring-indigo-500"
              >
                <option value="pending">pending</option>
                <option value="processing">processing</option>
                <option value="waiting_transcription">waiting_transcription</option>
                <option value="completed">completed</option>
                <option value="failed">failed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1">original_file_id</label>
            <input
              type="text"
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
              required
              className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1">local_file_path</label>
            <input
              type="text"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              required
              className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {status === 'completed' && (
            <div>
              <label className="block font-semibold text-slate-600 mb-1">transcription (optional)</label>
              <textarea
                value={transcription}
                onChange={(e) => setTranscription(e.target.value)}
                rows={2}
                placeholder="Текст расшифрованного голосового сообщения..."
                className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          {status === 'failed' && (
            <div>
              <label className="block font-semibold text-slate-600 mb-1">error description</label>
              <input
                type="text"
                value={errorText}
                onChange={(e) => setErrorText(e.target.value)}
                placeholder="e.g. Bot timeout or audio decode error"
                className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-slate-600 hover:text-slate-800 rounded font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Inserting...' : 'Insert into SQLite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
