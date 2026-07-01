import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export interface VideoClip {
  id: string;
  name: string;
  sourcePath?: string;
  startTime: number;
  endTime: number;
  duration: number;
  thumbnail?: string;
  tags: string[];
  transcript?: string;
  score?: number;
  createdAt: number;
}

export interface VideoProject {
  id: string;
  name: string;
  description: string;
  sourceFile: string;
  clips: VideoClip[];
  highlights: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface VideoAnalysis {
  duration: number;
  resolution: string;
  fps: number;
  chapters: Array<{ title: string; startTime: number; endTime: number }>;
  highlights: Array<{ timestamp: number; confidence: number; description: string }>;
  transcriptSegments: Array<{ start: number; end: number; text: string }>;
  sentimentTimeline: Array<{ timestamp: number; score: number }>;
}

export interface ClipRequest {
  projectId: string;
  startTime: number;
  endTime: number;
  name: string;
  tags?: string[];
}

class VideoClippingEngine extends EventEmitter {
  private projects: Map<string, VideoProject> = new Map();
  private analyses: Map<string, VideoAnalysis> = new Map();

  createProject(name: string, sourceFile: string, description = ''): VideoProject {
    const id = uuidv4();
    const project: VideoProject = {
      id,
      name,
      description,
      sourceFile,
      clips: [],
      highlights: [],
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.projects.set(id, project);
    this.emit('projectCreated', project);
    return project;
  }

  getProject(id: string): VideoProject | undefined {
    return this.projects.get(id);
  }

  listProjects(): VideoProject[] {
    return Array.from(this.projects.values());
  }

  deleteProject(id: string): boolean {
    const deleted = this.projects.delete(id);
    if (deleted) {
      this.analyses.delete(id);
      this.emit('projectDeleted', id);
    }
    return deleted;
  }

  async analyzeVideo(projectId: string): Promise<VideoAnalysis | null> {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const analysis: VideoAnalysis = {
      duration: 0,
      resolution: '1920x1080',
      fps: 30,
      chapters: [],
      highlights: [],
      transcriptSegments: [],
      sentimentTimeline: [],
    };

    this.analyses.set(projectId, analysis);
    this.emit('analysisComplete', { projectId, analysis });
    return analysis;
  }

  getAnalysis(projectId: string): VideoAnalysis | undefined {
    return this.analyses.get(projectId);
  }

  async extractClip(request: ClipRequest): Promise<VideoClip | null> {
    const project = this.projects.get(request.projectId);
    if (!project) return null;

    const clip: VideoClip = {
      id: uuidv4(),
      name: request.name,
      sourcePath: project.sourceFile,
      startTime: request.startTime,
      endTime: request.endTime,
      duration: request.endTime - request.startTime,
      tags: request.tags || [],
      createdAt: Date.now(),
    };

    project.clips.push(clip);
    project.updatedAt = Date.now();
    this.emit('clipExtracted', clip);
    return clip;
  }

  async findHighlights(projectId: string, maxClips = 10): Promise<VideoClip[]> {
    const project = this.projects.get(projectId);
    const analysis = this.analyses.get(projectId);
    if (!project || !analysis) return [];

    const highlights = analysis.highlights
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxClips);

    const clips: VideoClip[] = [];
    for (const h of highlights) {
      const clip: VideoClip = {
        id: uuidv4(),
        name: h.description,
        sourcePath: project.sourceFile,
        startTime: Math.max(0, h.timestamp - 15),
        endTime: h.timestamp + 15,
        duration: 30,
        tags: ['auto-highlight'],
        score: h.confidence,
        createdAt: Date.now(),
      };
      clips.push(clip);
    }

    this.emit('highlightsFound', { projectId, clips });
    return clips;
  }

  async addTranscript(projectId: string, segments: VideoAnalysis['transcriptSegments']): Promise<void> {
    const analysis = this.analyses.get(projectId);
    if (!analysis) return;
    analysis.transcriptSegments = segments;
    this.emit('transcriptAdded', { projectId, segments });
  }

  async splitByChapters(projectId: string): Promise<VideoClip[]> {
    const project = this.projects.get(projectId);
    const analysis = this.analyses.get(projectId);
    if (!project || !analysis) return [];

    const clips: VideoClip[] = [];
    for (const ch of analysis.chapters) {
      const clip: VideoClip = {
        id: uuidv4(),
        name: ch.title,
        sourcePath: project.sourceFile,
        startTime: ch.startTime,
        endTime: ch.endTime,
        duration: ch.endTime - ch.startTime,
        tags: ['chapter'],
        createdAt: Date.now(),
      };
      clips.push(clip);
      project.clips.push(clip);
    }

    project.updatedAt = Date.now();
    this.emit('splitByChapters', { projectId, clips });
    return clips;
  }

  addHighlight(projectId: string, timestamp: number, description: string): void {
    const analysis = this.analyses.get(projectId);
    if (!analysis) return;
    analysis.highlights.push({ timestamp, confidence: 1.0, description });
    this.emit('highlightAdded', { projectId, timestamp, description });
  }
}

export const videoEngine = new VideoClippingEngine();

