
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

type RoomColors = { [key: string]: number };

@Component({
  selector: 'app-three-d-view',
  standalone: true,
  templateUrl: './three-d-view.component.html',
  styleUrls: ['./three-d-view.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThreeDViewComponent implements OnDestroy {
  // Inputs
  plan = input<FloorPlan>(); 
  result = input<AnalysisResult | null>();
  viewType = input<'single' | 'building'>('single');
  
  landWidth = input.required<number>();
  landDepth = input.required<number>();
  
  neighborWestFloors = input<number>(0);
  neighborEastFloors = input<number>(0);
  customPolygon = input<{x: number, y: number}[] | undefined>();

  // Canvas element
  canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  // three.js properties
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private roomGroup!: THREE.Group;
  private animationFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;

  // Constants
  private readonly FLOOR_HEIGHT = 3.2;

  // Professional Neon/Glass Palette
  private readonly roomColors: RoomColors = {
    'living': 0x60a5fa,    // Blue
    'kitchen': 0xf472b6,   // Pink
    'bedroom': 0xa78bfa,   // Purple
    'bathroom': 0x2dd4bf,  // Teal
    'staircase': 0x94a3b8, // Slate
    'balcony': 0xfacc15,   // Yellow
    'void': 0x000000,      
    'hallway': 0xe2e8f0
  };

  constructor() {
    afterNextRender(() => {
      this.initThreeJs();
      this.createScene();
      this.animate();
    });

    effect(() => {
      // Trigger updates when inputs change
      this.plan();
      this.result();
      this.viewType();
      this.landWidth();
      this.landDepth();
      this.customPolygon();
      
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
    if (this.resizeObserver) {
        this.resizeObserver.disconnect();
    }
    this.cleanupScene();
  }

  private cleanupScene() {
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
        if (object instanceof THREE.LineSegments) {
            object.geometry.dispose();
            (object.material as THREE.Material).dispose();
        }
      });
    }
  }

  private initThreeJs(): void {
    const canvasEl = this.canvas().nativeElement;
    const containerEl = this.container().nativeElement;
    
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101012); 
    this.scene.fog = new THREE.Fog(0x101012, 30, 120); 

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, containerEl.clientWidth / containerEl.clientHeight, 0.1, 200);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
        canvas: canvasEl, 
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

    this.setupLighting();
    this.updateCameraPosition();

    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(containerEl);
    this.onResize();
  }

  private setupLighting(): void {
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.6);
    this.scene.add(hemiLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(40, 80, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.radius = 2;
    
    const d = 50;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    
    this.scene.add(dirLight);
  }

  private updateCameraPosition(): void {
    if (!this.camera) return;

    const landD = this.landDepth();
    const isBuilding = this.viewType() === 'building';
    const result = this.result();
    const totalFloors = result?.buildingSummary?.totalFloors || 1;
    
    // Offset camera slightly more for better perspective
    if (isBuilding) {
        const height = totalFloors * this.FLOOR_HEIGHT;
        this.camera.position.set(this.landWidth() * 1.5, height + 20, landD * 2);
        this.controls.target.set(0, height / 3, 0);
    } else {
        this.camera.position.set(0, landD * 1.5, landD * 1.5);
        this.controls.target.set(0, 0, 0);
    }
    this.controls.update();
  }

  private createScene(): void {
    this.roomGroup.clear();
    
    const landW = this.landWidth();
    const landD = this.landDepth();

    // 1. The Grid
    const gridHelper = new THREE.GridHelper(Math.max(landW, landD) * 4, 50, 0x3f3f46, 0x18181b);
    gridHelper.position.y = -0.05;
    this.roomGroup.add(gridHelper);

    // 2. The Base (Land Plot)
    let baseGeo: THREE.BufferGeometry;
    
    const polygon = this.customPolygon();

    if (polygon && polygon.length >= 3) {
        // Create shape from custom points
        const shape = new THREE.Shape();
        
        // The polygon points are normalized 0-1. We need to scale them to the calculated LandW/LandD
        // Note: logic in app.component mapped the bounds of the polygon to landW/landD.
        // We need to map 0-1 back to world coordinates centered at 0,0.
        
        // Find bounds of polygon first to center it
        const xs = polygon.map(p => p.x);
        const ys = polygon.map(p => p.y);
        const minX = Math.min(...xs); 
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys); 
        const maxY = Math.max(...ys);
        
        const widthRatio = landW / (maxX - minX);
        const heightRatio = landD / (maxY - minY);

        // Start point
        const startX = (polygon[0].x - minX) * widthRatio - landW / 2;
        const startY = (polygon[0].y - minY) * heightRatio - landD / 2; // Note: 2D Y is 3D Z usually
        
        shape.moveTo(startX, -startY); // In shape, Y is up (2D). In 3D, we rotate X.
        
        for (let i = 1; i < polygon.length; i++) {
             const px = (polygon[i].x - minX) * widthRatio - landW / 2;
             const py = (polygon[i].y - minY) * heightRatio - landD / 2;
             shape.lineTo(px, -py);
        }
        baseGeo = new THREE.ShapeGeometry(shape);
    } else {
        // Standard Rectangle
        baseGeo = new THREE.PlaneGeometry(landW, landD);
    }

    const baseMat = new THREE.MeshStandardMaterial({ 
        color: 0x18181b, 
        roughness: 0.8,
        side: THREE.DoubleSide
    });
    
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.rotation.x = -Math.PI / 2; // Rotate to lie flat
    base.receiveShadow = true;
    
    // Base Outline
    const edges = new THREE.EdgesGeometry(baseGeo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x38bdf8 })); // Cyan outline
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.02;
    
    this.roomGroup.add(line);
    this.roomGroup.add(base);

    // 3. Render Content
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
    const typicalPlan = floorPlans.length > 1 ? floorPlans.find(p => p.level > 0) || floorPlans[0] : floorPlans[0];
    const groundPlan = floorPlans.find(p => p.level === 0) || floorPlans[0];

    for (let i = 0; i < totalFloors; i++) {
        const elevation = i * this.FLOOR_HEIGHT;
        const planToRender = (i === 0) ? groundPlan : typicalPlan;
        
        this.renderFloor(planToRender, elevation, landW, landD, true);
        if (i > 0) this.renderSlab(elevation, landW, landD, planToRender);
    }
    
    // Roof
    this.renderSlab(totalFloors * this.FLOOR_HEIGHT, landW, landD, typicalPlan);
    this.renderNeighbors(landW, landD);
  }

  private renderNeighbors(landW: number, landD: number): void {
     const neighborDepth = landD;
     const neighborWidth = 15;
     
     const mat = new THREE.MeshBasicMaterial({ 
         color: 0xffffff, 
         transparent: true, 
         opacity: 0.05,
         side: THREE.DoubleSide
     });
     const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 });

     const createNeighbor = (h: number, xPos: number) => {
         const height = h * this.FLOOR_HEIGHT;
         const geom = new THREE.BoxGeometry(neighborWidth, height, neighborDepth);
         const mesh = new THREE.Mesh(geom, mat);
         mesh.position.set(xPos, height/2, 0);
         
         const edges = new THREE.EdgesGeometry(geom);
         const line = new THREE.LineSegments(edges, edgeMat);
         line.position.set(xPos, height/2, 0);

         this.roomGroup.add(mesh);
         this.roomGroup.add(line);
     };

     if (this.neighborWestFloors() > 0) {
         createNeighbor(this.neighborWestFloors(), -(landW/2 + neighborWidth/2 + 1));
     }

     if (this.neighborEastFloors() > 0) {
         createNeighbor(this.neighborEastFloors(), (landW/2 + neighborWidth/2 + 1));
     }
  }

  private renderSlab(elevation: number, landW: number, landD: number, plan: FloorPlan): void {
    const slabThickness = 0.1;
    // Darker slab to contrast with glass rooms
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 }); 

    const group = new THREE.Group();
    plan.rooms.forEach(room => {
        if (room.type === 'void') return;
        const w = (room.layout.width / 100) * landW;
        const d = (room.layout.height / 100) * landD;
        const geom = new THREE.BoxGeometry(w, slabThickness, d);
        const mesh = new THREE.Mesh(geom, slabMat);
        const posX = (room.layout.x / 100) * landW + w / 2 - landW / 2;
        const posZ = (room.layout.y / 100) * landD + d / 2 - landD / 2;
        mesh.position.set(posX, 0, posZ);
        group.add(mesh);
    });
    group.position.y = elevation - (slabThickness/2);
    this.roomGroup.add(group);
  }

  private renderFloor(plan: FloorPlan, elevation: number, landW: number, landD: number, isBuildingView: boolean = false): void {
    const roomHeight = isBuildingView ? this.FLOOR_HEIGHT - 0.15 : 2.8;

    plan.rooms.forEach(room => {
      if (room.type === 'void' && isBuildingView) return;

      const roomWidth = (room.layout.width / 100) * landW;
      const roomDepth = (room.layout.height / 100) * landD;
      
      const geometry = new THREE.BoxGeometry(roomWidth, roomHeight, roomDepth);
      const colorHex = this.roomColors[room.type] || 0xffffff;
      
      let material: THREE.Material;

      if (room.type === 'void') {
           material = new THREE.MeshBasicMaterial({ 
               color: 0xffffff, 
               wireframe: true,
               transparent: true, 
               opacity: 0.05
           });
      } else {
          // Glass / Crystal Material
          material = new THREE.MeshPhysicalMaterial({
              color: colorHex,
              metalness: 0.1,
              roughness: 0.1,
              transmission: 0.6, // Glassy transmission
              thickness: 0.5,
              transparent: true,
              opacity: 0.8,
              side: THREE.DoubleSide,
              clearcoat: 1.0,
              clearcoatRoughness: 0.1
          });
      }
      
      const mesh = new THREE.Mesh(geometry, material);
      const posX = (room.layout.x / 100) * landW + roomWidth / 2 - landW / 2;
      const posZ = (room.layout.y / 100) * landD + roomDepth / 2 - landD / 2;
      
      mesh.position.set(posX, elevation + roomHeight / 2, posZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true; // Self shadowing might look weird on glass, but keep for now
      this.roomGroup.add(mesh);

      // NEON EDGES
      if (room.type !== 'void') {
          const edges = new THREE.EdgesGeometry(geometry);
          const line = new THREE.LineSegments(
              edges, 
              new THREE.LineBasicMaterial({ 
                  color: colorHex, // Same color as room
                  linewidth: 2,
                  transparent: true,
                  opacity: 1.0 // Solid line
              })
          );
          line.position.copy(mesh.position);
          this.roomGroup.add(line);
      }
    });
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    if (!this.container()) return;
    const containerEl = this.container().nativeElement;
    if(containerEl.clientWidth === 0) return;
    
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
