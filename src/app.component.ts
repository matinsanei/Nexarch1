
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
  viewMode = signal<'2d' | '3d' | '3d-plus' | 'building-3d'>('2d');

  // Input signals
  landWidth = signal(10);
  landDepth = signal(20);
  neighborEastFloors = signal(2);
  neighborWestFloors = signal(2);

  // Result signals
  analysisResult = signal<AnalysisResult | null>(null);
  errorMessage = signal<string | null>(null);
  selectedFloor = signal(0);

  // Computed signal for displaying the current floor plan
  currentFloorPlan = computed(() => {
    const result = this.analysisResult();
    if (!result || !result.floorPlans) return null;
    // Handle potential index out of bounds if switching between results
    return result.floorPlans[this.selectedFloor()] || result.floorPlans[0];
  });

  // Dynamic messages for the loading screen
  loadingMessages = ['Analyzing zoning laws...', 'Considering neighborhood context...', 'Optimizing layout for maximum units...', 'Generating architectural floor plans...', 'Finalizing details...'];
  currentLoadingMessage = signal(this.loadingMessages[0]);
  private loadingInterval: any;


  async analyzePlot(): Promise<void> {
    if (this.landWidth() <= 0 || this.landDepth() <= 0) {
      this.errorMessage.set('لطفاً ابعاد معتبر برای زمین وارد کنید.');
      return;
    }

    this.step.set('loading');
    this.analysisResult.set(null);
    this.errorMessage.set(null);
    this.startLoadingMessages();

    try {
      const result = await this.geminiService.analyzeLand(
        this.landWidth(),
        this.landDepth(),
        this.neighborEastFloors(),
        this.neighborWestFloors()
      );
      this.analysisResult.set(result);
      this.selectedFloor.set(0); // Show ground floor first
      this.step.set('result');
    } catch (error) {
      console.error('Error analyzing land:', error);
      this.errorMessage.set('خطا در ارتباط با سرویس هوش مصنوعی. لطفاً دوباره تلاش کنید و از صحت ورودی‌ها اطمینان حاصل کنید.');
      this.step.set('input');
    } finally {
      this.stopLoadingMessages();
    }
  }

  startOver(): void {
    this.step.set('input');
    this.analysisResult.set(null);
    this.errorMessage.set(null);
    this.landWidth.set(10);
    this.landDepth.set(20);
    this.neighborEastFloors.set(2);
    this.neighborWestFloors.set(2);
    this.viewMode.set('2d');
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
