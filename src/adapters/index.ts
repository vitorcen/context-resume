import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import os from 'os';

export interface SessionSummary {
  id: string;
  title: string;
  preview: string;
  userPrompts: string[];
  timestamp: number;
  source: 'claude' | 'codex';
  path: string;
}

// --- Claude Adapter ---

function getClaudeEncodedPath(projectPath: string): string {
  // Claude encodes paths by replacing /, ., and _ with -
  // e.g. /home/user/project -> -home-user-project
  // e.g. /path/v1.0 -> -path-v1-0
  // e.g. /home/work_ro -> -home-work-ro
  return projectPath.replace(/[\/\._]/g, '-');
}

export async function getClaudeSessions(cwd: string, limit: number = 10): Promise<SessionSummary[]> {
  const homeDir = os.homedir();
  const encodedPath = getClaudeEncodedPath(cwd);
  const projectDir = path.join(homeDir, '.claude', 'projects', encodedPath);

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const files = glob.sync('*.jsonl', { cwd: projectDir });

  // Sort by modification time (descending)
  const sortedFiles = files.map((file: string) => {
      const filePath = path.join(projectDir, file);
      const stats = fs.statSync(filePath);
      return { file, mtime: stats.mtimeMs, filePath };
    })
    .sort((a: any, b: any) => b.mtime - a.mtime)
    .slice(0, limit);

  const sessions: SessionSummary[] = [];

  for (const { filePath, file } of sortedFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');

    if (lines.length === 0) continue;

    let firstUserMessage = 'New Session';
    let fullContent = '';
    const userPrompts: string[] = [];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        // Try to find the first user message for the title
        if (data.type === 'user' && data.message?.content) {
            const text = typeof data.message.content === 'string'
                ? data.message.content
                : (Array.isArray(data.message.content) ? data.message.content.map((c: any) => c.text || '').join(' ') : '');

            userPrompts.push(text);

          if (firstUserMessage === 'New Session') {
             firstUserMessage = text;
          }
        }

        // Accumulate content for preview (simplified)
        if (data.type === 'user' && data.message?.content) {
            const text = typeof data.message.content === 'string' ? data.message.content : 'User Input...';
            fullContent += `User: ${text}\n`;
        } else if (data.message?.content && data.type !== 'user') { // Assistant or other
             const text = typeof data.message.content === 'string' ? data.message.content : 'Assistant Output...';
             fullContent += `Assistant: ${text}\n`;
        } else if (data.display) {
             fullContent += `System: ${data.display}\n`;
        }

      } catch (e) {
        // ignore parse errors
      }
    }

    // Create preview: Start ... End
    const preview = createPreview(fullContent);
    const stats = fs.statSync(filePath);

    sessions.push({
      id: path.basename(file, '.jsonl'),
      title: firstUserMessage.slice(0, 50) + (firstUserMessage.length > 50 ? '...' : ''),
      preview,
      userPrompts,
      timestamp: stats.mtimeMs,
      source: 'claude',
      path: filePath
    });
  }

  return sessions;
}

// --- Codex Adapter ---

export async function getCodexSessions(cwd: string, limit: number = 10): Promise<SessionSummary[]> {
    const homeDir = os.homedir();
    const sessionsDir = path.join(homeDir, '.codex', 'sessions');

    if (!fs.existsSync(sessionsDir)) {
        return [];
    }

    // We need to search deeply because of the date structure YYYY/MM/DD
    // Optimization: Start searching from current year/month/day backwards could be better but glob is easier for MVP
    // To avoid scanning ALL history, maybe we limit glob depth or just look at recent folders?
    // For now, let's just glob all .jsonl and filter by CWD. In production, this should be optimized.
    // Actually, reading all files to check CWD is slow.
    // Strategy: Walk directories from today backwards?
    // Let's use a simpler approach: glob all jsonl in the last 3 levels of directories

    // Note: This might be slow if history is huge.
    const files = glob.sync('**/*.jsonl', { cwd: sessionsDir, absolute: true });

    // Filter by CWD and sort by time
    const relevantFiles: { filePath: string, mtime: number }[] = [];

    for (const filePath of files) {
        // We need to peek at the first line to check CWD
        try {
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(4096); // Read first 4KB
            const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
            fs.closeSync(fd);

            const chunk = buffer.toString('utf-8', 0, bytesRead);
            const firstLine = chunk.split('\n')[0];

            if (firstLine) {
                const meta = JSON.parse(firstLine);
                if (meta.type === 'session_meta' && meta.payload?.cwd === cwd) {
                     const stats = fs.statSync(filePath);
                     relevantFiles.push({ filePath, mtime: stats.mtimeMs });
                }
            }
        } catch (e) {
            // ignore
        }
    }

    const sortedFiles = relevantFiles
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

    const sessions: SessionSummary[] = [];

    for (const { filePath, mtime } of sortedFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim() !== '');

        let firstUserMessage = 'New Session';
        let fullContent = '';
        const userPrompts: string[] = [];

        for (const line of lines) {
            try {
                const data = JSON.parse(line);

                // Codex User Input
                if (data.type === 'response_item' && data.payload?.type === 'message' && data.payload.role === 'user') {
                    const contentArr = data.payload.content || [];
                    const text = contentArr.find((c: any) => c.type === 'input_text')?.text || '';

                    userPrompts.push(text);

                    if (firstUserMessage === 'New Session' && text) {
                        firstUserMessage = text;
                    }
                    fullContent += `User: ${text}\n`;
                }
                // Codex Assistant Response (simplified logic)
                // Codex format is a bit complex with chunks, we might just grab user inputs for now or simple responses if easily identifiable

            } catch (e) {
                // ignore
            }
        }

        const preview = createPreview(fullContent);

        sessions.push({
            id: path.basename(filePath, '.jsonl'),
            title: firstUserMessage.slice(0, 50) + (firstUserMessage.length > 50 ? '...' : ''),
            preview,
            userPrompts,
            timestamp: mtime,
            source: 'codex',
            path: filePath
        });
    }

    return sessions;
}

function createPreview(content: string, maxLength: number = 500): string {
    if (content.length <= maxLength) return content;

    const start = content.slice(0, maxLength / 2);
    const end = content.slice(content.length - (maxLength / 2));

    return `${start}\n\n... [${content.length - maxLength} characters omitted] ...\n\n${end}`;
}
