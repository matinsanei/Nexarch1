
import { 
  Component, 
  input, 
  ElementRef, 
  viewChild, 
  afterNextRender, 
  OnDestroy, 
  effect,
  ChangeDetectionStrategy
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FloorPlan, AnalysisResult } from '../services/gemini.service';

type RoomColors = { [key: string]: THREE.ColorRepresentation };

@Component({
  selector: 'app-three-d-view',
  standalone: true,
  templateUrl: './three-d-view.component.html',
  styleUrls: ['./three-d-view.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThreeDViewComponent implements OnDestroy {
  // Inputs
  plan = input<FloorPlan>(); // For single view
  result = input<AnalysisResult | null>(); // For building view
  viewType = input<'single' | 'building'>('single');
  
  landWidth = input.required<number>();
  landDepth = input.required<number>();
  
  neighborWestFloors = input<number>(0);
  neighborEastFloors = input<number>(0);

  // Canvas element
  canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  // three.js properties
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private roomGroup!: THREE.Group;
  private animationFrameId: number | null = null;

  // Constants
  private readonly FLOOR_HEIGHT = 3; // meters

  // Room color mapping
  private readonly roomColors: RoomColors = {
    'living': 0x059669,
    'kitchen': 0xD97706,
    'bedroom': 0x2563EB,
    'bathroom': 0x7C2D12,
    'staircase': 0x6B7280,
    'balcony': 0x0284C7,
    'void': 0x111827,
    'hallway': 0x4B5563
  };

  constructor() {
    afterNextRender(() => {
      this.initThreeJs();
      this.createScene();
      this.animate();
    });

    // Effect to re-render scene when inputs change
    effect(() => {
      // Register dependencies
      this.plan();
      this.result();
      this.viewType();
      this.landWidth();
      this.landDepth();
      this.neighborWestFloors();
      this.neighborEastFloors();

      if (this.scene) { 
        this.createScene();
        this.updateCameraPosition();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    // Clean up scene resources
     if (this.scene) {
      this.scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach(m => m.dispose());
          } else {
            (object.material as THREE.Material).dispose();
          }
        }
      });
    }
    if (this.controls) {
      this.controls.dispose();
    }
  }

  private initThreeJs(): void {
    const canvasEl = this.canvas().nativeElement;
    
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1f2937); // bg-gray-800

    // Camera initialization
    this.camera = new THREE.PerspectiveCamera(50, canvasEl.clientWidth / canvasEl.clientHeight, 0.1, 1000);
    this.updateCameraPosition();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvasEl.clientWidth, canvasEl.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't allow going below ground

    // Lighting
    this.setupLighting();

    // Group for rooms
    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    // Handle resize
    new ResizeObserver(() => this.onResize()).observe(canvasEl.parentElement!);
  }

  private setupLighting(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(20, 50, 30);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 200;
    // Adjust shadow camera frustum to cover larger buildings
    const shadowSize = 50;
    dirLight.shadow.camera.left = -shadowSize;
    dirLight.shadow.camera.right = shadowSize;
    dirLight.shadow.camera.top = shadowSize;
    dirLight.shadow.camera.bottom = -shadowSize;
    this.scene.add(dirLight);
  }

  private updateCameraPosition(): void {
    if (!this.camera) return;

    const landD = this.landDepth();
    const isBuilding = this.viewType() === 'building';
    const result = this.result();
    const totalFloors = result?.buildingSummary?.totalFloors || 1;
    
    if (isBuilding) {
        // Position camera to see the whole building
        const height = totalFloors * this.FLOOR_HEIGHT;
        this.camera.position.set(this.landWidth() * 1.5, height * 0.8, landD * 1.5);
    } else {
        // Standard floor view
        this.camera.position.set(0, landD * 0.75, landD);
    }
    this.camera.lookAt(0, (totalFloors * this.FLOOR_HEIGHT) / 3, 0);
  }

  private createScene(): void {
    // Clear previous objects
    this.roomGroup.clear();
    
    const landW = this.landWidth();
    const landD = this.landDepth();

    // 1. Ground plane (Street/Plot context)
    // Make ground slightly larger than plot
    const groundW = landW * 3;
    const groundD = landD * 3;
    const groundGeometry = new THREE.PlaneGeometry(groundW, groundD);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x374151, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05; // Slightly below zero
    ground.receiveShadow = true;
    this.roomGroup.add(ground);

    // Plot outline
    const plotGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(landW, 0.1, landD));
    const plotMat = new THREE.LineBasicMaterial({ color: 0x4B5563 }); // Gray-600
    const plotLines = new THREE.LineSegments(plotGeo, plotMat);
    plotLines.position.y = 0.05;
    this.roomGroup.add(plotLines);

    if (this.viewType() === 'building') {
        this.createBuildingScene(landW, landD);
    } else {
        const plan = this.plan();
        if (plan) {
             this.renderFloor(plan, 0, landW, landD);
        }
    }
  }

  private createBuildingScene(landW: number, landD: number): void {
    const result = this.result();
    if (!result) return;

    const totalFloors = result.buildingSummary.totalFloors;
    const floorPlans = result.floorPlans;
    
    // Find a typical floor plan (usually the last one or one that isn't ground)
    // If only ground exists, use it for all.
    const typicalPlan = floorPlans.length > 1 ? floorPlans.find(p => p.level > 0) || floorPlans[0] : floorPlans[0];
    const groundPlan = floorPlans.find(p => p.level === 0) || floorPlans[0];

    for (let i = 0; i < totalFloors; i++) {
        const elevation = i * this.FLOOR_HEIGHT;
        const planToRender = (i === 0) ? groundPlan : typicalPlan;
        
        // Render the floor rooms
        this.renderFloor(planToRender, elevation, landW, landD, true);

        // Add a concrete slab between floors
        if (i > 0) {
             this.renderSlab(elevation, landW, landD, planToRender);
        }
    }

    // Render Roof
    const roofElevation = totalFloors * this.FLOOR_HEIGHT;
    this.renderSlab(roofElevation, landW, landD, typicalPlan);

    // Neighbors
    this.renderNeighbors(landW, landD);
  }

  private renderNeighbors(landW: number, landD: number): void {
     // Neighbors are rendered as simple massing models
     const neighborDepth = landD; // Assume same depth
     const neighborWidth = 10; // Arbitrary width for context
     const mat = new THREE.MeshStandardMaterial({ 
         color: 0x6B7280, 
         transparent: true, 
         opacity: 0.3,
         roughness: 0.8
     });

     // West Neighbor (Left side, -X)
     if (this.neighborWestFloors() > 0) {
         const h = this.neighborWestFloors() * this.FLOOR_HEIGHT;
         const geom = new THREE.BoxGeometry(neighborWidth, h, neighborDepth);
         const mesh = new THREE.Mesh(geom, mat);
         // Position: Center X = -landW/2 - neighborWidth/2 - gap
         mesh.position.set(-(landW/2 + neighborWidth/2 + 0.5), h/2, 0);
         mesh.castShadow = true;
         this.roomGroup.add(mesh);
     }

     // East Neighbor (Right side, +X)
     if (this.neighborEastFloors() > 0) {
         const h = this.neighborEastFloors() * this.FLOOR_HEIGHT;
         const geom = new THREE.BoxGeometry(neighborWidth, h, neighborDepth);
         const mesh = new THREE.Mesh(geom, mat);
         mesh.position.set((landW/2 + neighborWidth/2 + 0.5), h/2, 0);
         mesh.castShadow = true;
         this.roomGroup.add(mesh);
     }
  }

  private renderSlab(elevation: number, landW: number, landD: number, plan: FloorPlan): void {
    // A simple slab covering the bounding box of non-void rooms or just the full plot minus voids?
    // For simplicity in this generated model, we create a slab for the whole plot but try to respect voids if possible.
    // A simpler approach: A generic slab at 0,0 with size of plot, but "void" rooms cut through it? 
    // Implementing CSG in vanilla Three.js is hard. 
    // Strategy: Just render a thin box for the whole plot, assuming voids are open to sky in the 3D logic (but physically floor plates usually wrap around).
    // Better Strategy: Render floor plates matching the "rooms" x/y/w/h but with a concrete color, excluding 'void'.
    
    const slabThickness = 0.2;
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xD1D5DB }); // Light gray concrete

    plan.rooms.forEach(room => {
        if (room.type === 'void') return; // Don't build slab over void

        const w = (room.layout.width / 100) * landW;
        const d = (room.layout.height / 100) * landD;
        const geom = new THREE.BoxGeometry(w, slabThickness, d);
        const mesh = new THREE.Mesh(geom, slabMat);
        
        const posX = (room.layout.x / 100) * landW + w / 2 - landW / 2;
        const posZ = (room.layout.y / 100) * landD + d / 2 - landD / 2;

        mesh.position.set(posX, elevation - (slabThickness/2), posZ);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.roomGroup.add(mesh);
    });
  }

  private renderFloor(plan: FloorPlan, elevation: number, landW: number, landD: number, isBuildingView: boolean = false): void {
    // Adjust room height slightly if building view to allow for slab thickness overlap prevention
    const roomHeight = isBuildingView ? this.FLOOR_HEIGHT - 0.2 : 2.5;

    plan.rooms.forEach(room => {
      // Don't render void volume in building mode, it should be empty space
      if (room.type === 'void' && isBuildingView) return; 

      const roomWidth = (room.layout.width / 100) * landW;
      const roomDepth = (room.layout.height / 100) * landD;
      
      const geometry = new THREE.BoxGeometry(roomWidth, roomHeight, roomDepth);
      
      // Material logic
      const color = this.roomColors[room.type] || 0xffffff;
      let material: THREE.Material;

      if (room.type === 'void') {
          // Ghostly appearance for void in single view
          material = new THREE.MeshStandardMaterial({ 
              color: 0x000000, 
              wireframe: true,
              transparent: true, 
              opacity: 0.2 
          });
      } else {
          material = new THREE.MeshStandardMaterial({ color });
      }
      
      const mesh = new THREE.Mesh(geometry, material);

      const posX = (room.layout.x / 100) * landW + roomWidth / 2 - landW / 2;
      const posZ = (room.layout.y / 100) * landD + roomDepth / 2 - landD / 2;
      
      // Y Position: Center of the box is at elevation + half height
      mesh.position.set(posX, elevation + roomHeight / 2, posZ);
      
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.roomGroup.add(mesh);
    });
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    const parent = this.canvas()?.nativeElement.parentElement;
    if (parent) {
        this.camera.aspect = parent.clientWidth / parent.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(parent.clientWidth, parent.clientHeight);
    }
  }
}
