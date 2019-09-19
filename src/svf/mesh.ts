import { PackFileReader, IVector3 } from './packfile-reader';

/**
 * Triangular mesh data, including indices, vertices, optional normals and UVs.
 */
export interface IMesh {
    vcount: number; // Num of vertices
    tcount: number; // Num of triangles
    uvcount: number; // Num of UV maps
    attrs: number; // Number of attributes per vertex
    flags: number;
    comment: string;
    uvmaps: IUVMap[];
    indices: Uint16Array;
    vertices: Float32Array;
    normals?: Float32Array;
    min: IVector3;
    max: IVector3;
}

/**
 * Single UV channel. {@link IMesh} can have more of these.
 */
export interface IUVMap {
    name: string;
    file: string;
    uvs: Float32Array;
}

/**
 * Parses meshes from a binary buffer, typically stored in files called '<number>.pf',
 * referenced in the SVF manifest as an asset of type 'Autodesk.CloudPlatform.PackFile'.
 * @generator
 * @param {Buffer} buffer Binary buffer to parse.
 * @returns {Iterable<IMesh | null>} Instances of parsed meshes, or null values
 * if the mesh cannot be parsed (and to maintain the indices used in {@link IGeometry}).
 */
export function *parseMeshes(buffer: Buffer): Iterable<IMesh | null> {
    const pfr = new PackFileReader(buffer);
    for (let i = 0, len = pfr.numEntries(); i < len; i++) {
        const entry = pfr.seekEntry(i);
        console.assert(entry);
        console.assert(entry.version >= 1);

        switch (entry._type) {
            case 'Autodesk.CloudPlatform.OpenCTM':
                yield parseMeshOCTM(pfr);
            case 'Autodesk.CloudPlatform.Lines': // TODO
                console.warn('Unsupported mesh type', entry._type);
                yield null;
            case 'Autodesk.CloudPlatform.Points': // TODO
                console.warn('Unsupported mesh type', entry._type);
                yield null;
        }
    }
}

function parseMeshOCTM(pfr: PackFileReader): IMesh | null {
    const fourcc = pfr.getString(4);
    console.assert(fourcc === 'OCTM');
    const version = pfr.getInt32();
    console.assert(version === 5);
    const method = pfr.getString(3);
    pfr.getUint8(); // Read the last 0 char of the RAW or MG2 fourCC

    switch (method) {
        case 'RAW':
            return parseMeshRAW(pfr);
        default:
            console.warn('Unsupported OpenCTM method', method);
            return null;
    }
}

function parseMeshRAW(pfr: PackFileReader): IMesh {
    // We will create a single ArrayBuffer to back both the vertex and index buffers.
    // The indices will be places after the vertex information, because we need alignment of 4 bytes.

    const vcount = pfr.getInt32(); // Num of vertices
    const tcount = pfr.getInt32(); // Num of triangles
    const uvcount = pfr.getInt32(); // Num of UV maps
    const attrs = pfr.getInt32(); // Number of attributes per vertex
    const flags = pfr.getInt32(); // Additional flags (e.g., whether normals are present)
    const comment = pfr.getString(pfr.getInt32());

    // Indices
    let name = pfr.getString(4);
    console.assert(name === 'INDX');
    const indices = new Uint16Array(tcount * 3);
    for (let i = 0; i < tcount * 3; i++) {
        indices[i] = pfr.getUint32();
    }

    // Vertices
    name = pfr.getString(4);
    console.assert(name === 'VERT');
    const vertices = new Float32Array(vcount * 3);
    const min = { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE };
    const max = { x: Number.MIN_VALUE, y: Number.MIN_VALUE, z: Number.MIN_VALUE };
    for (let i = 0; i < vcount * 3; i += 3) {
        const x = vertices[i] = pfr.getFloat32();
        const y = vertices[i + 1] = pfr.getFloat32();
        const z = vertices[i + 2] = pfr.getFloat32();
        min.x = Math.min(min.x, x);
        max.x = Math.max(max.x, x);
        min.y = Math.min(min.y, y);
        max.y = Math.max(max.y, y);
        min.z = Math.min(min.z, z);
        max.z = Math.max(max.z, z);
    }

    // Normals
    let normals: Float32Array | null = null;
    if (flags & 1) {
        name = pfr.getString(4);
        console.assert(name === 'NORM');
        normals = new Float32Array(vcount * 3);
        for (let i = 0; i < vcount; i++) {
            let x = pfr.getFloat32();
            let y = pfr.getFloat32();
            let z = pfr.getFloat32();
            // Make sure the normals have unit length
            const dot = x * x + y * y + z * z;
            if (dot !== 1.0) {
                const len = Math.sqrt(dot);
                x /= len;
                y /= len;
                z /= len;
            }
            normals[i * 3] = x;
            normals[i * 3 + 1] = y;
            normals[i * 3 + 2] = z;
        }
    }

    // Parse zero or more UV maps
    const uvmaps: IUVMap[] = [];
    for (let i = 0; i < uvcount; i++) {
        name = pfr.getString(4);
        console.assert(name === 'TEXC');
        const uvmap: IUVMap = {
            name: '',
            file: '',
            uvs: new Float32Array()
        };
        uvmap.name = pfr.getString(pfr.getInt32());
        uvmap.file = pfr.getString(pfr.getInt32());
        uvmap.uvs = new Float32Array(vcount * 2);
        for (let j = 0; j < vcount * 2; j++) {
            uvmap.uvs[j] = pfr.getFloat32();
        }
        uvmaps.push(uvmap);
    }

    const mesh: IMesh = { vcount, tcount, uvcount, attrs, flags, comment, uvmaps, indices, vertices, min, max };
    if (normals) {
        mesh.normals = normals;
    }
    return mesh;
}
