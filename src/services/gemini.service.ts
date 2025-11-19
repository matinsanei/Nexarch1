import { Injectable } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';

export interface Room {
  name: string;
  type: 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'staircase' | 'balcony' | 'void' | 'hallway';
  area: number;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FloorPlan {
  level: number;
  rooms: Room[];
}

export interface BuildingSummary {
    summary: string;
    totalFloors: number;
    unitsPerFloor: number;
}

export interface AnalysisResult {
  buildingSummary: BuildingSummary;
  floorPlans: FloorPlan[];
}

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    // The API key is expected to be available as `process.env.API_KEY` in the execution environment.
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("API Key is missing. Please ensure it's set in the environment variables.");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async analyzeLand(width: number, depth: number, neighborWestFloors: number, neighborEastFloors: number): Promise<AnalysisResult> {
    const prompt = `
      **Role:** You are an expert Iranian architect AI.
      **Task:** Design a multi-unit residential building for a plot of land in Iran, considering zoning laws, neighbor context, and practicality.
      
      **Land Dimensions:**
      - Width (along street): ${width} meters
      - Depth: ${depth} meters

      **Neighborhood Context:**
      - West Neighbor: ${neighborWestFloors} floors. This affects lighting and privacy on the west side.
      - East Neighbor: ${neighborEastFloors} floors. This affects lighting and privacy on the east side.
      - Assume the north side faces the main street and is the primary source of light and access.
      - Assume the south side is the backyard/courtyard.

      **Instructions:**
      1.  **Determine Optimal Building:** Based on standard Iranian regulations (e.g., 60% + 2m rule for buildable depth, maximizing vertical space), determine the optimal number of floors and units per floor.
      2.  **Design a Typical Floor Plan:** Create a logical and efficient layout for a typical floor. If ground floor (level 0) needs a different layout (e.g., for parking or lobby), design that as well.
          - The layout should be represented as a list of rooms.
          - Each room must have a name, type, area (in m²), and a layout object.
          - The layout object ('x', 'y', 'width', 'height') must define the room's bounding box as percentages of the total land dimensions, making it easy to render. For example, a room covering the whole width would have 'x':0, 'width':100. A room starting halfway down the depth would have 'y':50.
          - Include essential spaces: Living room, Kitchen, Bedroom(s), Bathroom(s), and a Staircase for vertical access.
          - If there are unbuilt areas within the building footprint (like a central void for light), label them as 'void'.
      3.  **Provide a Summary:** Write a brief summary explaining your design choices (e.g., why you chose a certain number of floors or units).
      4.  **Output:** Return the entire response in a single, valid JSON object matching the provided schema. No markdown.
    `;
    
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        buildingSummary: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: 'A brief summary of the architectural design decisions in Persian.'
            },
            totalFloors: {
              type: Type.NUMBER,
              description: 'The optimal total number of floors for the building.'
            },
            unitsPerFloor: {
              type: Type.NUMBER,
              description: 'The number of residential units designed for a typical floor.'
            }
          },
          required: ['summary', 'totalFloors', 'unitsPerFloor']
        },
        floorPlans: {
          type: Type.ARRAY,
          description: 'An array of floor plan objects, one for each level of the building.',
          items: {
            type: Type.OBJECT,
            properties: {
              level: {
                type: Type.NUMBER,
                description: 'The floor level (0 for ground floor, 1 for the first floor, etc.).'
              },
              rooms: {
                type: Type.ARRAY,
                description: 'A list of all rooms and spaces on this floor.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: 'The Persian name of the room (e.g., "اتاق خواب").' },
                    type: { 
                      type: Type.STRING,
                      enum: ['living', 'kitchen', 'bedroom', 'bathroom', 'staircase', 'balcony', 'void', 'hallway'],
                      description: 'The type of the room from the allowed enum.'
                    },
                    area: { type: Type.NUMBER, description: 'The calculated area of the room in square meters.' },
                    layout: {
                      type: Type.OBJECT,
                      properties: {
                        x: { type: Type.NUMBER, description: 'The percentage offset from the left edge of the plot.' },
                        y: { type: Type.NUMBER, description: 'The percentage offset from the top edge of the plot.' },
                        width: { type: Type.NUMBER, description: 'The percentage width of the room relative to the plot width.' },
                        height: { type: Type.NUMBER, description: 'The percentage height of the room relative to the plot depth.' }
                      },
                      required: ['x', 'y', 'width', 'height']
                    }
                  },
                  required: ['name', 'type', 'area', 'layout']
                }
              }
            },
            required: ['level', 'rooms']
          }
        }
      },
      required: ['buildingSummary', 'floorPlans']
    };

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
          temperature: 0.3,
        },
      });

      const jsonString = response.text.trim();
      const result = JSON.parse(jsonString) as AnalysisResult;

      // Basic validation
      if (!result.buildingSummary || !result.floorPlans || result.floorPlans.length === 0) {
        throw new Error('Invalid data format from API: Missing essential fields.');
      }
      
      return result;

    } catch (error) {
      console.error('Gemini API Error:', error);
      throw new Error('Failed to get a valid response from the AI model.');
    }
  }
}