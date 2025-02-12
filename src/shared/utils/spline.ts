/**
 * Utility class for B-spline curve interpolation to create smooth lines
 */
export class BSpline {
    private degree: number;
    private knots: number[] = [];
    
    constructor(degree: number = 3) {
        this.degree = degree;
    }

    /**
     * Generate uniform knot vector
     */
    private generateKnots(numPoints: number): number[] {
        const numKnots = numPoints + this.degree + 1;
        const knots: number[] = [];
        
        // Add degree + 1 zeros at start
        for (let i = 0; i <= this.degree; i++) {
            knots.push(0);
        }
        
        // Add middle knots
        const middle = numKnots - 2 * (this.degree + 1);
        for (let i = 1; i <= middle; i++) {
            knots.push(i / (middle + 1));
        }
        
        // Add degree + 1 ones at end
        for (let i = 0; i <= this.degree; i++) {
            knots.push(1);
        }
        
        return knots;
    }

    /**
     * De Boor's algorithm for B-spline evaluation
     */
    private deBoor(knots: number[], points: number[][], t: number, dimension: number): number {
        const n = points.length - 1;
        const d = this.degree;
        
        // Find knot span
        let s = this.degree;
        for (let i = this.degree; i < n; i++) {
            if (t >= knots[i] && t < knots[i + 1]) {
                s = i;
                break;
            }
        }
        
        // Initialize control points for this span
        const v: number[][] = [];
        for (let i = 0; i <= d; i++) {
            v[i] = [...points[s - d + i]];
        }
        
        // De Boor recursion
        for (let r = 1; r <= d; r++) {
            for (let j = d; j >= r; j--) {
                const alpha = (t - knots[s - d + j]) / (knots[s + j - r + 1] - knots[s - d + j]);
                for (let k = 0; k < dimension; k++) {
                    v[j][k] = (1 - alpha) * v[j - 1][k] + alpha * v[j][k];
                }
            }
        }
        
        return v[d][dimension];
    }

    /**
     * Generate smooth curve points from control points
     */
    generateCurve(controlPoints: Array<{x: number, y: number}>, numSamples: number = 100): Array<{x: number, y: number}> {
        if (controlPoints.length < 2) return controlPoints;
        
        // Convert points to array format
        const points = controlPoints.map(p => [p.x, p.y]);
        
        // Generate knot vector
        this.knots = this.generateKnots(points.length);
        
        // Generate curve points
        const curvePoints: Array<{x: number, y: number}> = [];
        const step = 1 / (numSamples - 1);
        
        for (let t = 0; t <= 1; t += step) {
            const x = this.deBoor(this.knots, points, t, 0);
            const y = this.deBoor(this.knots, points, t, 1);
            curvePoints.push({x, y});
        }
        
        return curvePoints;
    }
}
