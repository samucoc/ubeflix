import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Image, Subtitles, CheckCircle, XCircle, Loader } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function ProgressToast() {
  const [tasks, setTasks] = useState({});
  const eventSourcesRef = useRef({});
  const pollingRef = useRef(null);

  // Poll for active tasks
  const pollActiveTasks = useCallback(async () => {
    try {
      const token = localStorage.getItem('ubeflix_token');
      const res = await fetch(`${API_URL}/subtitles/progress/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const activeTasks = await res.json();
      activeTasks.forEach((task) => {
        if (!eventSourcesRef.current[task.taskId] && task.status === 'running') {
          subscribeToTask(task.taskId);
        }
      });
    } catch {}
  }, []);

  useEffect(() => {
    pollActiveTasks();
    pollingRef.current = setInterval(pollActiveTasks, 5000);
    return () => {
      clearInterval(pollingRef.current);
      Object.values(eventSourcesRef.current).forEach((es) => es.close());
    };
  }, [pollActiveTasks]);

  const subscribeToTask = useCallback((taskId) => {
    if (eventSourcesRef.current[taskId]) return;

    const token = localStorage.getItem('ubeflix_token');
    const es = new EventSource(
      `${API_URL}/subtitles/progress/stream/${encodeURIComponent(taskId)}?token=${encodeURIComponent(token)}`
    );

    eventSourcesRef.current[taskId] = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setTasks((prev) => ({ ...prev, [data.taskId]: data }));

        if (data.status === 'completed' || data.status === 'error') {
          es.close();
          delete eventSourcesRef.current[taskId];
          // Remove from UI after 4s
          setTimeout(() => {
            setTasks((prev) => {
              const next = { ...prev };
              delete next[taskId];
              return next;
            });
          }, 4000);
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      delete eventSourcesRef.current[taskId];
    };
  }, []);

  // Expose subscribe method globally so LibrariesPage can trigger it
  useEffect(() => {
    window.__ubeflix_subscribeTask = subscribeToTask;
    return () => { delete window.__ubeflix_subscribeTask; };
  }, [subscribeToTask]);

  const taskList = Object.values(tasks);
  if (taskList.length === 0) return null;

  return (
    <div className="progress-toast-container">
      {taskList.map((task) => (
        <div
          key={task.taskId}
          className={`progress-toast ${task.status === 'completed' ? 'completed' : task.status === 'error' ? 'error' : ''}`}
        >
          <div className="progress-toast-header">
            <span className="progress-toast-icon">
              {task.status === 'completed' ? (
                <CheckCircle size={18} />
              ) : task.status === 'error' ? (
                <XCircle size={18} />
              ) : task.type === 'thumbs' ? (
                <Image size={18} className="spin" />
              ) : (
                <Subtitles size={18} className="spin" />
              )}
            </span>
            <span className="progress-toast-label">{task.label}</span>
            <span className="progress-toast-percent">
              {task.status === 'completed' ? '✓' : task.status === 'error' ? '✗' : `${task.percent}%`}
            </span>
          </div>
          <div className="progress-toast-bar-bg">
            <div
              className="progress-toast-bar"
              style={{ width: `${task.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
