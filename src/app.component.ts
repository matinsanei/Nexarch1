
import { ChangeDetectionStrategy, Component, computed, inject, signal, ElementRef, viewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService, AnalysisResult } from './services/gemini.service';
import { ThreeDViewComponent } from './three-d-view/three-d-view.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ThreeDViewComponent]
})
export class AppComponent {
  private geminiService = inject(GeminiService);

  // Step management
  step = signal<'input' | 'loading' | 'result'>('input');
  inputType = signal<'numeric' | 'draw'>('numeric');
  viewMode = signal<'2d' | '3d' | '3d-plus' | 'building-3d'>('building-3d');

  // Numeric Input signals
  landWidth = signal(10);
  landDepth = signal(20);
  neighborEastFloors = signal(2);
  neighborWestFloors = signal(2);

  // Drawing Input signals
  drawCanvas = viewChild<ElementRef<HTMLCanvasElement>>('drawCanvas');
  polygonPoints = signal<{x: number, y: number}[]>([]); // Normalized 0-1 coordinates
  isDrawingValid = computed(() => this.polygonPoints().length >= 3);
  
  // Result signals
  analysisResult = signal<AnalysisResult | null>(null);
  errorMessage = signal<string | null>(null);
  selectedFloor = signal(0);

  // Computed signal for displaying the current floor plan
  currentFloorPlan = computed(() => {
    const result = this.analysisResult();
    if (!result || !result.floorPlans) return null;
    return result.floorPlans[this.selectedFloor()] || result.floorPlans[0];
  });

  loadingMessages = ['Analyzing zoning laws...', 'Considering neighborhood context...', 'Optimizing layout...', 'Generating plans...', 'Finalizing details...'];
  currentLoadingMessage = signal(this.loadingMessages[0]);
  private loadingInterval: any;

  // Drawing Logic Helpers
  private readonly MAX_GRID_SIZE_METERS = 50; // The canvas represents a 50x50m area

  constructor() {
    effect(() => {
      if (this.inputType() === 'draw' && this.step() === 'input') {
        // Small delay to ensure canvas is in DOM
        setTimeout(() => this.redrawCanvas(), 50);
      }
    });
  }

  // --- Drawing Methods ---

  onCanvasClick(event: MouseEvent) {
    if (this.step() !== 'input' || this.inputType() !== 'draw') return;
    
    const canvas = this.drawCanvas()?.nativeElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    this.polygonPoints.update(points => [...points, {x, y}]);
    this.redrawCanvas();
  }

  undoPoint() {
    this.polygonPoints.update(points => points.slice(0, -1));
    this.redrawCanvas();
  }

  resetDrawing() {
    this.polygonPoints.set([]);
    this.redrawCanvas();
  }

  private redrawCanvas() {
    const canvas = this.drawCanvas()?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = '#27272a'; // zinc-800
    ctx.lineWidth = 1;
    const gridSize = 40; 
    
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    const points = this.polygonPoints();
    if (points.length === 0) return;

    // Draw Polygon
    ctx.beginPath();
    ctx.moveTo(points[0].x * width, points[0].y * height);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * width, points[i].y * height);
    }
    if (points.length > 2) {
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fill();
    }
    
    ctx.strokeStyle = '#38bdf8'; // sky-400
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw Points
    ctx.fillStyle = '#fff';
    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // --- Analysis ---

  async analyzePlot(): Promise<void> {
    let finalWidth = this.landWidth();
    let finalDepth = this.landDepth();

    if (this.inputType() === 'draw') {
      if (!this.isDrawingValid()) {
        this.errorMessage.set('لطفاً حداقل ۳ نقطه برای ترسیم زمین مشخص کنید.');
        return;
      }
      // Calculate Bounding Box of the polygon in meters
      const points = this.polygonPoints();
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      // Convert percentage to meters (based on MAX_GRID_SIZE_METERS)
      finalWidth = (maxX - minX) * this.MAX_GRID_SIZE_METERS;
      finalDepth = (maxY - minY) * this.MAX_GRID_SIZE_METERS;
      
      // Normalize result for decent constraints (e.g. min 5m)
      finalWidth = Math.max(5, parseFloat(finalWidth.toFixed(1)));
      finalDepth = Math.max(5, parseFloat(finalDepth.toFixed(1)));
    } else {
       if (this.landWidth() <= 0 || this.landDepth() <= 0) {
        this.errorMessage.set('لطفاً ابعاد معتبر برای زمین وارد کنید.');
        return;
      }
    }

    // Set the signals used by 3D view to the calculated/input dimensions
    this.landWidth.set(finalWidth);
    this.landDepth.set(finalDepth);

    this.step.set('loading');
    this.analysisResult.set(null);
    this.errorMessage.set(null);
    this.startLoadingMessages();

    try {
      const result = await this.geminiService.analyzeLand(
        finalWidth,
        finalDepth,
        this.neighborEastFloors(),
        this.neighborWestFloors()
      );
      this.analysisResult.set(result);
      this.selectedFloor.set(0);
      this.step.set('result');
      this.viewMode.set('building-3d');
    } catch (error) {
      console.error('Error analyzing land:', error);
      this.errorMessage.set('خطا در ارتباط با سرویس هوش مصنوعی.');
      this.step.set('input');
    } finally {
      this.stopLoadingMessages();
    }
  }

  startOver(): void {
    this.step.set('input');
    this.analysisResult.set(null);
    this.errorMessage.set(null);
    // Don't reset polygon points to allow re-editing
  }
  
  private startLoadingMessages(): void {
    let messageIndex = 0;
    this.currentLoadingMessage.set(this.loadingMessages[0]);
    this.loadingInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % this.loadingMessages.length;
      this.currentLoadingMessage.set(this.loadingMessages[messageIndex]);
    }, 2500);
  }

  private stopLoadingMessages(): void {
    clearInterval(this.loadingInterval);
  }
}
