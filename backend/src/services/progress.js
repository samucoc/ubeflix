/**
 * In-memory progress tracker for long-running tasks.
 * Supports SSE (Server-Sent Events) for real-time updates.
 */

// Map<taskId, { type, label, current, total, status, clients: Set<res> }>
const tasks = new Map();

function createTask(taskId, label, total) {
  const task = {
    type: taskId.split(':')[0], // e.g. 'thumbs', 'subs'
    label,
    current: 0,
    total,
    status: 'running', // running | completed | error
    error: null,
    clients: new Set(),
    createdAt: Date.now(),
  };
  tasks.set(taskId, task);
  broadcast(taskId);
  return task;
}

function updateTask(taskId, current, extra) {
  const task = tasks.get(taskId);
  if (!task) return;
  task.current = current;
  if (extra) Object.assign(task, extra);
  broadcast(taskId);
}

function completeTask(taskId, message) {
  const task = tasks.get(taskId);
  if (!task) return;
  task.status = 'completed';
  task.current = task.total;
  if (message) task.label = message;
  broadcast(taskId);
  // Clean up after 10 seconds
  setTimeout(() => {
    const t = tasks.get(taskId);
    if (t) {
      t.clients.forEach(res => {
        try { res.end(); } catch {}
      });
      tasks.delete(taskId);
    }
  }, 10000);
}

function failTask(taskId, error) {
  const task = tasks.get(taskId);
  if (!task) return;
  task.status = 'error';
  task.error = error;
  broadcast(taskId);
  setTimeout(() => {
    const t = tasks.get(taskId);
    if (t) {
      t.clients.forEach(res => {
        try { res.end(); } catch {}
      });
      tasks.delete(taskId);
    }
  }, 10000);
}

function broadcast(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;
  const data = {
    taskId,
    type: task.type,
    label: task.label,
    current: task.current,
    total: task.total,
    percent: task.total > 0 ? Math.round((task.current / task.total) * 100) : 0,
    status: task.status,
    error: task.error,
  };
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  task.clients.forEach(res => {
    try { res.write(msg); } catch {}
  });
}

function subscribe(taskId, res) {
  const task = tasks.get(taskId);
  if (!task) return false;
  task.clients.add(res);
  // Send current state immediately
  broadcast(taskId);
  return true;
}

function unsubscribe(taskId, res) {
  const task = tasks.get(taskId);
  if (task) task.clients.delete(res);
}

function getActiveTasks() {
  const result = [];
  for (const [taskId, task] of tasks) {
    result.push({
      taskId,
      type: task.type,
      label: task.label,
      current: task.current,
      total: task.total,
      percent: task.total > 0 ? Math.round((task.current / task.total) * 100) : 0,
      status: task.status,
      error: task.error,
    });
  }
  return result;
}

module.exports = {
  createTask,
  updateTask,
  completeTask,
  failTask,
  subscribe,
  unsubscribe,
  getActiveTasks,
};
