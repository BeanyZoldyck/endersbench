import type { Material } from 'three';

// Keep Three's fog color/uniforms, but measure distance from the map center.
// Interpolate world XZ before measuring radius so large ground triangles and
// instanced trees share the same boundary, independent of camera pan or zoom.
const onBeforeCompile: Material['onBeforeCompile'] = shader => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec2 vMapFogPosition;')
    .replace('#include <fog_vertex>', `
      #include <fog_vertex>
      vec4 mapFogPosition = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        mapFogPosition = batchingMatrix * mapFogPosition;
      #endif
      #ifdef USE_INSTANCING
        mapFogPosition = instanceMatrix * mapFogPosition;
      #endif
      vMapFogPosition = (modelMatrix * mapFogPosition).xz;
    `);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nvarying vec2 vMapFogPosition;')
    .replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        float mapFogAmount = smoothstep(fogNear, fogFar, length(vMapFogPosition));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, mapFogAmount);
      #endif
    `);
};

export const boundaryFog = { onBeforeCompile, customProgramCacheKey: () => 'map-boundary-fog-v1' };
