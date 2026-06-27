import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  Box,
  ChevronDown,
  Database,
  FileUp,
  Layers,
  RadioTower,
  Route,
  Search,
  TowerControl,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || '';
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GOOGLE_3D_TILES_API_KEY || '';
const USE_GOOGLE_3D_TILES = parseFlag(import.meta.env.VITE_USE_GOOGLE_3D_TILES || import.meta.env.VITE_ENABLE_GOOGLE_3D_TILES);
const USE_CESIUM_WORLD_TERRAIN = parseFlag(import.meta.env.VITE_USE_CESIUM_WORLD_TERRAIN, true);
const USE_OSM_FALLBACK = parseFlag(import.meta.env.VITE_USE_OSM_FALLBACK, true);
const ARCGIS_TOPO_TILE_URL = `${API_BASE}/api/tiles/arcgis-topo/{z}/{y}/{x}`;
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const PREFERRED_IMAGERY_SOURCE = String(import.meta.env.VITE_PREFERRED_IMAGERY_SOURCE || 'osm').toLowerCase();
const DEFAULT_TOWER_HEIGHT_M = 35;
const DEFAULT_ROUTE_HEIGHT_M = Number(import.meta.env.VITE_DEFAULT_ROUTE_HEIGHT_M || 80);
// Visual-only lift so tower/route entities remain visible above Cesium terrain; this is not AGL.
const DISPLAY_HEIGHT_OFFSET_M = 120;
const DEFAULT_TAIAN_VIEW = { lon: 117.0876, lat: 36.2000, height: 16000 };
const MAP_MODES = {
  BASIC_GRID: 'basic_grid',
  TERRAIN_IMAGERY: 'terrain_imagery',
  PHOTOREALISTIC_3D_TILES: 'photorealistic_3d_tiles',
  LOCAL_TERRAIN_FUTURE: 'local_terrain_future',
};
const TERRAIN_EXAGGERATION_LEVELS = [1, 1.5, 2, 3];
const STREET_MAP_MIN_ZOOM = 8;
const STREET_MAP_MAX_ZOOM = 18;
const DEFAULT_TERRAIN_EXAGGERATION = 1.5;
const TERRAIN_CONTOUR_SPACING_M = 80;
const CESIUM_TILE_CACHE_SIZE = clampNumber(Number(import.meta.env.VITE_CESIUM_TILE_CACHE_SIZE || 512), 128, 1200);
const CESIUM_TILE_WARMUP_MS = clampNumber(Number(import.meta.env.VITE_CESIUM_TILE_WARMUP_MS || 4500), 0, 15000);
const CESIUM_PRELOAD_SIBLINGS = parseFlag(import.meta.env.VITE_CESIUM_PRELOAD_SIBLINGS, false);
const CESIUM_MAXIMUM_SCREEN_SPACE_ERROR = clampNumber(
  Number(import.meta.env.VITE_CESIUM_MAXIMUM_SCREEN_SPACE_ERROR || 3),
  1,
  8,
);
const STREET_MAP_TILE_PADDING = clampNumber(Number(import.meta.env.VITE_STREET_MAP_TILE_PADDING || 2), 0, 6);
const COMMUNICATION_FREQUENCY_GHZ = clampNumber(Number(import.meta.env.VITE_COMMUNICATION_FREQUENCY_GHZ || 2.4), 0.4, 8);
const COMMUNICATION_BASE_ANTENNA_HEIGHT_M = clampNumber(
  Number(import.meta.env.VITE_COMMUNICATION_BASE_ANTENNA_HEIGHT_M || 25),
  3,
  120,
);
const COMMUNICATION_TERRAIN_MARGIN_M = clampNumber(
  Number(import.meta.env.VITE_COMMUNICATION_TERRAIN_MARGIN_M || 12),
  0,
  80,
);
const COMMUNICATION_SAMPLE_COUNT = clampNumber(Number(import.meta.env.VITE_COMMUNICATION_SAMPLE_COUNT || 18), 8, 40);
const COMMUNICATION_ROUTE_LINK_LIMIT = clampNumber(Number(import.meta.env.VITE_COMMUNICATION_ROUTE_LINK_LIMIT || 12), 4, 24);
// Visual-only lift for communication corridors when terrain cache is not ready; not used for LOS/NLOS decisions.
const COMMUNICATION_PENDING_VISUAL_LIFT_M = 650;

const routeColorHexes = ['#ffe45e', '#54d2ff', '#ff6f59', '#a7ff83', '#dcb0ff'];
const routeColors = routeColorHexes.map((color) => Cesium.Color.fromCssColorString(color));

function parseFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function App() {
  const cesiumEl = useRef(null);
  const viewerRef = useRef(null);
  const handlerRef = useRef(null);
  const entityRefs = useRef([]);
  const communicationRefs = useRef([]);

  const [data, setData] = useState({
    towers: null,
    lines: null,
    routes: null,
    waypoints: null,
    baseStations: null,
    metrics: [],
    tasks: [],
    dataQuality: null,
    dataQualityIssues: [],
    coordinateBackfillTemplate: [],
    coordinateBackfillValidation: null,
    manifest: null,
  });
  const [filters, setFilters] = useState({ line: '', tower: '' });
  const [layerState, setLayerState] = useState({
    towers: true,
    routes: true,
    waypoints: true,
    stations: true,
    lines: true,
    communication: true,
  });
  const [visibleRoutes, setVisibleRoutes] = useState(new Set());
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selected, setSelected] = useState(null);
  const [communicationProjection, setCommunicationProjection] = useState(null);
  const [mapStatus, setMapStatus] = useState({
    viewer: 'initializing',
    basemap: 'Loading',
    terrain: 'Loading',
    google3dTiles: USE_GOOGLE_3D_TILES && GOOGLE_MAPS_API_KEY ? 'configured' : 'not configured',
    cesiumIon: CESIUM_ION_TOKEN ? 'configured' : 'not configured',
    lastError: '',
    lastTerrainError: '',
    displayOffset: `${DISPLAY_HEIGHT_OFFSET_M} m visual offset (not AGL)`,
    terrainProvider: 'not configured',
    imageryProvider: 'not configured',
    tilesProvider: 'not configured',
    cameraHeight: '',
    cameraPitch: '',
    cameraHeading: '',
    terrainExaggeration: `${DEFAULT_TERRAIN_EXAGGERATION}x`,
    mapMode: MAP_MODES.TERRAIN_IMAGERY,
    lastMapLoadingError: '',
    tileCache: `${CESIUM_TILE_CACHE_SIZE} tiles`,
    tileWarmup: `${CESIUM_TILE_WARMUP_MS} ms initial visible-area warmup`,
    tileStrategy: `visible first; DOM buffer ${STREET_MAP_TILE_PADDING} tiles; Cesium sibling preload ${CESIUM_PRELOAD_SIBLINGS ? 'on' : 'off'}`,
    terrainVisual: 'pending',
    scaleLabel: '',
    scaleWidthPx: 96,
    scaleRatio: '',
    communicationOverlay: 'semi-transparent Fresnel corridor visual prototype',
  });
  const [mapMode, setMapMode] = useState(MAP_MODES.TERRAIN_IMAGERY);
  const [terrainExaggeration, setTerrainExaggeration] = useState(DEFAULT_TERRAIN_EXAGGERATION);
  const [kmlImport, setKmlImport] = useState({
    files: [],
    note: '',
    uploading: false,
    status: '',
    error: '',
    batchId: '',
  });
  const [communicationStatus, setCommunicationStatus] = useState({
    enabled: true,
    status: 'pending',
    label: 'waiting for route data',
    source: 'auto',
    route: '',
    waypoint: '',
    linkDistance: '',
    requiredRadius: '',
    frequency: `${COMMUNICATION_FREQUENCY_GHZ} GHz`,
    model: 'semi-transparent visual prototype',
    terrainSource: 'Cesium terrain display only; not DEM/DSM',
    boundary: 'not an engineering coverage or safety conclusion',
  });

  useEffect(() => {
    async function loadData() {
      const nextData = await loadDashboardData();
      setData(nextData);
      setSelectedRouteId('');
      const routeIds = nextData.routes.features.map((feature) => feature.properties.route_id);
      setVisibleRoutes(new Set(routeIds));
    }
    loadData().catch((error) => {
      setMapStatus((current) => ({ ...current, lastError: `数据加载失败：${error.message}` }));
      setSelected({ title: '数据加载失败', properties: { error: String(error) } });
    });
  }, []);

  useEffect(() => {
    if (!cesiumEl.current || viewerRef.current) return;
    if (CESIUM_ION_TOKEN) {
      Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
    }
    const viewer = new Cesium.Viewer(cesiumEl.current, {
      animation: false,
      baseLayerPicker: false,
      baseLayer: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      scene3DOnly: true,
      showRenderLoopErrors: false,
      timeline: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });
    viewer.__taishanDisposed = false;
    viewer.imageryLayers.removeAll();
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#17283a');
    viewer.scene.globe.show = true;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#2f5962');
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
    }
    viewer.scene.globe.depthTestAgainstTerrain = false;
    // Keep imagery readable regardless of local day/night. This is visual only, not a lighting simulation.
    viewer.scene.globe.enableLighting = false;
    configureCameraControls(viewer);
    configureTileLoading(viewer);
    if (viewer.scene.moon) {
      viewer.scene.moon.show = true;
    }
    if (viewer.scene.sun) {
      viewer.scene.sun.show = true;
    }
    if (viewer.cesiumWidget?.creditContainer) {
      viewer.cesiumWidget.creditContainer.style.display = 'none';
    }
    viewer.camera.percentageChanged = 0.05;
    viewer.camera.changed.addEventListener(() => updateCameraStatus(viewer, setMapStatus));
    viewer.scene.renderError.addEventListener((sceneOrError, maybeError) => {
      const error = maybeError || sceneOrError;
      recoverFromMapRenderError(viewer, setMapStatus, error);
    });
    focusCameraOnPoint(viewer, DEFAULT_TAIAN_VIEW.lon, DEFAULT_TAIAN_VIEW.lat, DEFAULT_TAIAN_VIEW.height, 0);
    viewerRef.current = viewer;
    setMapStatus((current) => ({ ...current, viewer: 'created' }));
    configureMapMode(viewer, setMapStatus, MAP_MODES.TERRAIN_IMAGERY, DEFAULT_TERRAIN_EXAGGERATION);

    handlerRef.current = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current.setInputAction((movement) => {
      selectSceneObject(viewer, movement.position, setSelected, setSelectedRouteId);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handlerRef.current?.destroy();
      viewer.__taishanDisposed = true;
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    configureMapMode(viewer, setMapStatus, mapMode, terrainExaggeration);
  }, [mapMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    applyTerrainExaggeration(viewer, terrainExaggeration);
    setMapStatus((current) => ({
      ...current,
      terrainExaggeration: `${terrainExaggeration}x`,
      terrainProvider: getTerrainProviderName(viewer),
      scaleLabel: current.scaleLabel,
    }));
    getViewerSceneSafe(viewer)?.requestRender();
  }, [terrainExaggeration]);

  const routeFeatures = data.routes?.features || [];
  const filtered = useMemo(() => filterData(data, filters, visibleRoutes), [data, filters, visibleRoutes]);
  const businessLayerState = useMemo(() => ({
    towers: layerState.towers,
    routes: layerState.routes,
    waypoints: layerState.waypoints,
    stations: layerState.stations,
    lines: layerState.lines,
  }), [layerState.towers, layerState.routes, layerState.waypoints, layerState.stations, layerState.lines]);
  const selectedRoutePoints = useMemo(
    () => getRoutePoints(data.waypoints, selectedRouteId),
    [data.waypoints, selectedRouteId],
  );
  const selectedMetric = data.metrics.find((item) => item.route_id === selectedRouteId);
  const selectedWaypointIndex = useMemo(
    () => getSelectedWaypointIndex(selected, selectedRouteId, selectedRoutePoints),
    [selected, selectedRouteId, selectedRoutePoints],
  );

  useEffect(() => {
    const routeId = selected?.properties?.route_id;
    if (routeId && routeId !== selectedRouteId) {
      setSelectedRouteId(routeId);
    }
  }, [selected, selectedRouteId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !filtered.towers || !filtered.routes || !filtered.waypoints) return;
    clearEntities(viewer, entityRefs.current);
    entityRefs.current = [];

    if (businessLayerState.lines && filtered.lines) {
      addLineEntities(viewer, filtered.lines, entityRefs.current, setSelected);
      addLineLabelEntities(viewer, filtered.lines, entityRefs.current);
    }
    if (businessLayerState.towers) {
      addTowerEntities(viewer, filtered.towers, entityRefs.current);
    }
    if (businessLayerState.stations && filtered.baseStations) {
      addStationEntities(viewer, filtered.baseStations, entityRefs.current);
    }
    if (businessLayerState.routes) {
      addRouteEntities(viewer, filtered.routes, data.metrics, entityRefs.current);
    }
    if (businessLayerState.waypoints) {
      addWaypointEntities(viewer, filtered.waypoints, data.metrics, entityRefs.current);
    }
    viewer.__taishanPickableEntities = [...entityRefs.current, ...communicationRefs.current];
    if (mapMode === MAP_MODES.PHOTOREALISTIC_3D_TILES) {
      flyTo3DSceneView(viewer, filtered, setMapStatus);
    } else {
      flyToData(viewer, filtered);
    }
    updateCameraStatus(viewer, setMapStatus);
  }, [filtered, data.metrics, businessLayerState, mapMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    let disposed = false;

    const refreshCommunicationLayer = () => {
      if (disposed) return;
      clearEntities(viewer, communicationRefs.current);
      communicationRefs.current = [];

      if (!layerState.communication) {
        const disabledStatus = {
          enabled: false,
          status: 'disabled',
          label: 'overlay disabled',
          source: 'not shown',
          route: selectedMetric?.kml_file || '',
          waypoint: '',
          linkDistance: '',
          requiredRadius: '',
          frequency: `${COMMUNICATION_FREQUENCY_GHZ} GHz`,
          model: 'semi-transparent visual prototype',
          terrainSource: 'not sampled',
          boundary: 'not an engineering coverage or safety conclusion',
        };
        viewer.__taishanCommunicationStatus = disabledStatus;
        viewer.__taishanCommunicationProjection = null;
        viewer.__taishanPickableEntities = entityRefs.current;
        setCommunicationStatus(disabledStatus);
        setCommunicationProjection(null);
        return;
      }

      if (!selectedRouteId) {
        const routeRequiredStatus = {
          enabled: true,
          status: 'pending',
          label: '请选择一条航线',
          source: '等待航线选择',
          route: '',
          waypoint: '',
          linkDistance: '',
          requiredRadius: '',
          frequency: `${COMMUNICATION_FREQUENCY_GHZ} GHz`,
          model: '选择 KML 航线后显示半透明视距 / 菲涅尔走廊',
          terrainSource: 'not sampled',
          boundary: 'visual prototype only; not real communication coverage, AGL, or safety conclusion',
        };
        viewer.__taishanCommunicationStatus = routeRequiredStatus;
        viewer.__taishanCommunicationProjection = null;
        viewer.__taishanPickableEntities = entityRefs.current;
        setCommunicationStatus(routeRequiredStatus);
        setCommunicationProjection(null);
        return;
      }

      const plan = buildCommunicationPlan(
        data.baseStations,
        selectedRoutePoints,
        selectedMetric,
        selectedWaypointIndex,
      );

      if (!plan) {
        const pendingStatus = {
          enabled: true,
          status: 'pending',
          label: 'waiting for base station and route data',
          source: 'auto',
          route: selectedMetric?.kml_file || '',
          waypoint: '',
          linkDistance: '',
          requiredRadius: '',
          frequency: `${COMMUNICATION_FREQUENCY_GHZ} GHz`,
          model: 'semi-transparent visual prototype',
          terrainSource: 'Cesium terrain display only; not DEM/DSM',
          boundary: 'not an engineering coverage or safety conclusion',
        };
        viewer.__taishanCommunicationStatus = pendingStatus;
        viewer.__taishanCommunicationProjection = null;
        viewer.__taishanPickableEntities = entityRefs.current;
        setCommunicationStatus(pendingStatus);
        setCommunicationProjection(null);
        return;
      }

      const communicationResult = addCommunicationEntities(viewer, plan, communicationRefs.current);
      viewer.__taishanCommunicationStatus = communicationResult.status;
      viewer.__taishanCommunicationProjection = communicationResult.projection;
      viewer.__taishanPickableEntities = [...entityRefs.current, ...communicationRefs.current];
      setCommunicationStatus(communicationResult.status);
      setCommunicationProjection(communicationResult.projection);
      getViewerSceneSafe(viewer)?.requestRender();
    };

    refreshCommunicationLayer();
    const retryTimers = [1500, 4200].map((delay) => window.setTimeout(refreshCommunicationLayer, delay));

    return () => {
      disposed = true;
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      clearEntities(viewer, communicationRefs.current);
      communicationRefs.current = [];
      viewer.__taishanPickableEntities = entityRefs.current;
      viewer.__taishanCommunicationProjection = null;
      setCommunicationProjection(null);
    };
  }, [
    data.baseStations,
    selectedRouteId,
    selectedRoutePoints,
    selectedMetric,
    selectedWaypointIndex,
    layerState.communication,
    mapMode,
  ]);

  const stats = {
    lines: data.lines?.features.length || 0,
    towers: data.towers?.features.length || 0,
    routes: routeFeatures.length,
    tasks: data.tasks.length,
  };

  const handleKmlImport = async (event) => {
    event.preventDefault();
    if (!kmlImport.files.length || kmlImport.uploading) return;
    setKmlImport((current) => ({ ...current, uploading: true, status: '正在导入并重建航线数据...', error: '', batchId: '' }));
    const formData = new FormData();
    kmlImport.files.forEach((file) => formData.append('files', file));
    if (kmlImport.note.trim()) {
      formData.append('note', kmlImport.note.trim());
    }
    try {
      const response = await fetch(`${API_BASE}/api/import/kml-routes`, {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || `导入失败：${response.status}`);
      }
      const nextData = await loadDashboardData();
      setData(nextData);
      const routeIds = nextData.routes.features.map((feature) => feature.properties.route_id);
      setVisibleRoutes(new Set(routeIds));
      const importedRouteId = findRouteIdByImportedFile(nextData.routes, payload.files?.[0]?.stored_filename);
      setSelectedRouteId(importedRouteId || routeIds.at(-1) || '');
      setSelected({
        title: 'KML 导入结果',
        properties: {
          status: payload.status,
          imported_files: (payload.files || []).map((file) => file.stored_filename).join(', '),
          routes_after_import: payload.row_counts?.routes ?? '',
          waypoints_after_import: payload.row_counts?.route_waypoints ?? '',
          data_boundary: 'KML 已新增到 data/raw/kml 并重建标准化数据；若字段含义异常仍需人工复核。',
        },
      });
      setKmlImport({
        files: [],
        note: '',
        uploading: false,
        status: `导入完成：${payload.file_count || 0} 个 KML，航线数据已刷新。`,
        error: '',
        batchId: '',
      });
    } catch (error) {
      setKmlImport((current) => ({
        ...current,
        uploading: false,
        status: '',
        error: error.message || String(error),
      }));
    }
  };
  const showTerrainView = () => {
    setMapMode(MAP_MODES.TERRAIN_IMAGERY);
    setTerrainExaggeration((current) => Math.max(Number(current) || 1, 2));
    window.setTimeout(() => flyToTerrainView(viewerRef.current, filtered, setMapStatus), 120);
  };

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof window === 'undefined') return;
    window.__taishanViewer = viewer;
    window.__taishanMapDebug = () => buildMapDebugSnapshot(viewer, mapMode, mapStatus);
  }, [mapMode, mapStatus]);

  return (
    <main className="sand-table" data-map-mode={mapMode}>
      <div ref={cesiumEl} className="cesium-stage" />
      {mapMode === MAP_MODES.TERRAIN_IMAGERY && (
        <StreetMapLayer
          filtered={filtered}
          layerState={layerState}
          metrics={data.metrics}
          selected={selected}
          communicationProjection={communicationProjection}
          setSelected={setSelected}
          setSelectedRouteId={setSelectedRouteId}
          variant="terrain"
        />
      )}
      <ScaleBar status={mapStatus} />
      <header className="topbar">
        <div className="title-lockup">
          <Box size={24} />
          <div>
            <h1>无人机航线通信地形模拟沙盘</h1>
            <span>{formatMapStatus(mapStatus)}</span>
          </div>
        </div>
        <Metric label="线路" value={stats.lines} />
        <Metric label="杆塔" value={stats.towers} />
        <Metric label="KML 航线" value={stats.routes} />
        <Metric label="任务" value={stats.tasks} />
      </header>

      <aside className="left-panel">
        <section className="tool-section">
          <h2><Search size={16} />数据筛选</h2>
          <label className="field-line">
            <span>线路</span>
            <input value={filters.line} onChange={(event) => setFilters({ ...filters, line: event.target.value })} placeholder="输入线路名称" />
          </label>
          <label className="field-line">
            <span>杆号</span>
            <input value={filters.tower} onChange={(event) => setFilters({ ...filters, tower: event.target.value })} placeholder="输入杆号" />
          </label>
        </section>

        <section className="tool-section import-section">
          <h2><FileUp size={16} />导入 KML 航线</h2>
          <form onSubmit={handleKmlImport}>
            <label className="file-picker">
              <span>{kmlImport.files.length ? `${kmlImport.files.length} 个 KML 已选择` : '选择 .kml 文件'}</span>
              <input
                accept=".kml"
                multiple
                type="file"
                onChange={(event) => setKmlImport((current) => ({
                  ...current,
                  files: Array.from(event.target.files || []),
                  status: '',
                  error: '',
                }))}
              />
            </label>
            <input
              className="import-note"
              value={kmlImport.note}
              onChange={(event) => setKmlImport((current) => ({ ...current, note: event.target.value }))}
              placeholder="备注：来源/线路/杆号待核对"
            />
            <button className="wide-tool-button" disabled={!kmlImport.files.length || kmlImport.uploading} type="submit">
              {kmlImport.uploading ? '导入中...' : '导入并刷新航线'}
            </button>
          </form>
          <div className={`import-status ${kmlImport.error ? 'error' : ''}`}>
            {kmlImport.error || kmlImport.status || '仅新增 KML，不覆盖已有原始文件'}
          </div>
        </section>

        <section className="tool-section">
          <h2><Layers size={16} />图层</h2>
          <Toggle label="杆塔光柱" checked={layerState.towers} onChange={() => setLayerState({ ...layerState, towers: !layerState.towers })} />
          <Toggle label="线路候选" checked={layerState.lines} onChange={() => setLayerState({ ...layerState, lines: !layerState.lines })} />
          <Toggle label="KML 航线" checked={layerState.routes} onChange={() => setLayerState({ ...layerState, routes: !layerState.routes })} />
          <Toggle label="航点" checked={layerState.waypoints} onChange={() => setLayerState({ ...layerState, waypoints: !layerState.waypoints })} />
          <Toggle label="基站/机场候选" checked={layerState.stations} onChange={() => setLayerState({ ...layerState, stations: !layerState.stations })} />
        </section>

        <section className="tool-section">
          <h2><Layers size={16} />地图模式</h2>
          <div className="segmented-control">
            <button className={mapMode === MAP_MODES.TERRAIN_IMAGERY ? 'active' : ''} onClick={() => setMapMode(MAP_MODES.TERRAIN_IMAGERY)}>地形影像</button>
            <button className={mapMode === MAP_MODES.BASIC_GRID ? 'active' : ''} onClick={() => setMapMode(MAP_MODES.BASIC_GRID)}>基础网格</button>
            <button className={mapMode === MAP_MODES.PHOTOREALISTIC_3D_TILES ? 'active' : ''} onClick={() => setMapMode(MAP_MODES.PHOTOREALISTIC_3D_TILES)}>3D Tiles</button>
          </div>
          <button className="wide-tool-button" onClick={showTerrainView}>地形观察视角</button>
          <div className="segmented-control compact">
            {TERRAIN_EXAGGERATION_LEVELS.map((level) => (
              <button key={level} className={terrainExaggeration === level ? 'active' : ''} onClick={() => setTerrainExaggeration(level)}>{level}x</button>
            ))}
          </div>
        </section>

        <section className="tool-section communication-control">
          <h2><RadioTower size={16} />通信遮挡演示</h2>
          <Toggle
            label="半透明菲涅尔走廊"
            checked={Boolean(selectedRouteId && layerState.communication)}
            disabled={!selectedRouteId}
            onChange={() => setLayerState({ ...layerState, communication: !layerState.communication })}
          />
          <div className={`communication-mini ${communicationStatus.status}`}>
            <strong>{communicationStatus.label}</strong>
            <span>源点：{communicationStatus.source || 'auto'}</span>
            <span>链路：{communicationStatus.linkDistance || 'pending'}</span>
            <small>{selectedRouteId ? '视觉原型，不输出工程通信覆盖结论' : '先在航线列表或地图上选择一条 KML 航线'}</small>
          </div>
        </section>

        <section className="tool-section route-list">
          <h2><Route size={16} />航线开关</h2>
          {routeFeatures.map((feature) => {
            const id = feature.properties.route_id;
            const metric = data.metrics.find((item) => item.route_id === id);
            const selectRoute = () => {
              setSelectedRouteId(id);
              setSelected(buildRouteSelection(feature, metric, 'route list'));
            };
            return (
              <button
                className={`route-switch ${selectedRouteId === id ? 'selected' : ''}`}
                key={id}
                onClick={selectRoute}
              >
                <input
                  type="checkbox"
                  checked={visibleRoutes.has(id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectRoute();
                  }}
                  onChange={(event) => {
                    event.stopPropagation();
                    selectRoute();
                    toggleRoute(id, visibleRoutes, setVisibleRoutes);
                  }}
                />
                <span>
                  <strong>{feature.properties.kml_file}</strong>
                  <small>{Number(metric?.total_length || 0).toFixed(1)} m · {metric?.route_type_guess}</small>
                </span>
              </button>
            );
          })}
        </section>
      </aside>

      <aside className="right-panel">
        <h2><Database size={16} />{selected?.title || '对象属性'}</h2>
        <SelectionSummaryPanel selected={selected} selectedMetric={selectedMetric} />
        <CommunicationStatusPanel status={communicationStatus} />
        <MapStatusPanel status={mapStatus} />
        <ManifestSummaryPanel
          manifest={data.manifest}
          onSelect={(manifest) => setSelected(buildManifestSelection(manifest))}
        />
        <QualitySummaryPanel quality={data.dataQuality} />
        <QualityIssuesPanel
          issues={data.dataQualityIssues}
          onSelectIssue={(issue) => setSelected(buildQualityIssueSelection(issue))}
        />
        <CoordinateBackfillPanel
          rows={data.coordinateBackfillTemplate}
          validation={data.coordinateBackfillValidation}
          onSelect={(row) => setSelected(buildCoordinateBackfillSelection(row, data.coordinateBackfillTemplate.length))}
        />
        <PropertyTable
          properties={selected?.properties || defaultSelection(selectedMetric)}
          title={selected?.title || (selectedMetric ? 'KML 航线' : '对象')}
        />
      </aside>

    </main>
  );
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

async function fetchOptionalJson(path) {
  try {
    return await fetchJson(path);
  } catch {
    return null;
  }
}

async function loadDashboardData() {
  const [
    towers,
    lines,
    routes,
    waypoints,
    baseStations,
    metrics,
    tasks,
    dataQuality,
    dataQualityIssues,
    coordinateBackfillTemplate,
    coordinateBackfillValidation,
    manifest,
  ] = await Promise.all([
    fetchJson('/api/geojson/towers'),
    fetchJson('/api/geojson/lines'),
    fetchJson('/api/geojson/routes'),
    fetchJson('/api/geojson/route_waypoints'),
    fetchJson('/api/geojson/base_stations'),
    fetchJson('/api/metrics'),
    fetchJson('/api/tasks'),
    fetchOptionalJson('/api/data-quality'),
    fetchOptionalJson('/api/data-quality/issues'),
    fetchOptionalJson('/api/data-quality/coordinate-backfill-template'),
    fetchOptionalJson('/api/data-quality/coordinate-backfill-validation-report'),
    fetchOptionalJson('/api/manifest'),
  ]);
  return {
    towers,
    lines,
    routes,
    waypoints,
    baseStations,
    metrics,
    tasks,
    dataQuality,
    dataQualityIssues: Array.isArray(dataQualityIssues) ? dataQualityIssues : [],
    coordinateBackfillTemplate: Array.isArray(coordinateBackfillTemplate) ? coordinateBackfillTemplate : [],
    coordinateBackfillValidation,
    manifest,
  };
}

function DataOverlay({ filtered, mapStatus }) {
  const shouldShowFallbackOverlay = (
    mapStatus?.basemap === 'Fallback basic scene'
    || mapStatus?.imageryProvider === 'fallback grid'
    || mapStatus?.terrain === 'fallback basic scene'
  );
  if (!shouldShowFallbackOverlay) return null;
  if (!filtered?.towers || !filtered?.routes) return null;
  const bounds = expandBounds(computeDataBounds(filtered), 0.035);
  if (!bounds) return null;
  const width = 1000;
  const height = 620;
  const project = (coordinate) => {
    const lon = coordinate[0];
    const lat = coordinate[1];
    const x = ((lon - bounds.west) / Math.max(bounds.east - bounds.west, 1e-9)) * width;
    const y = (1 - ((lat - bounds.south) / Math.max(bounds.north - bounds.south, 1e-9))) * height;
    return { x, y };
  };
  const toPoints = (coordinates) => coordinates.map((coordinate) => {
    const point = project(coordinate);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');
  const activateSelection = (event, selection) => {
    event.stopPropagation();
    setSelected(selection);
  };
  const grid = Array.from({ length: 9 }, (_, index) => index / 8);
  return (
    <div className="data-overlay" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <filter id="overlayGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="overlay-plane" x="0" y="0" width={width} height={height} />
        {grid.map((ratio) => (
          <line
            className="overlay-grid"
            key={`gx-${ratio}`}
            x1={ratio * width}
            y1="0"
            x2={ratio * width}
            y2={height}
          />
        ))}
        {grid.map((ratio) => (
          <line
            className="overlay-grid"
            key={`gy-${ratio}`}
            x1="0"
            y1={ratio * height}
            x2={width}
            y2={ratio * height}
          />
        ))}
        {(filtered.lines?.features || []).map((feature, index) => (
          <polyline
            className="overlay-line"
            key={`line-${index}`}
            points={toPoints(feature.geometry.coordinates || [])}
          />
        ))}
        {(filtered.routes?.features || []).map((feature, index) => (
          <polyline
            className="overlay-route"
            key={feature.properties?.route_id || `route-${index}`}
            points={toPoints(feature.geometry.coordinates || [])}
            stroke={routeColorHexes[index % routeColorHexes.length]}
          />
        ))}
        {(filtered.waypoints?.features || []).map((feature, index) => {
          const point = project(feature.geometry.coordinates);
          return <circle className="overlay-waypoint" key={`wp-${index}`} cx={point.x} cy={point.y} r="3" />;
        })}
        {(filtered.towers?.features || []).map((feature, index) => {
          const point = project(feature.geometry.coordinates);
          return <circle className="overlay-tower" key={feature.properties?.tower_id || `tower-${index}`} cx={point.x} cy={point.y} r="3.2" />;
        })}
        {(filtered.baseStations?.features || []).map((feature, index) => {
          const point = project(feature.geometry.coordinates);
          return (
            <path
              className="overlay-station"
              key={feature.properties?.station_id || `station-${index}`}
              d={`M ${point.x} ${point.y - 8} L ${point.x + 8} ${point.y + 7} L ${point.x - 8} ${point.y + 7} Z`}
            />
          );
        })}
      </svg>
    </div>
  );
}

function StreetMapLayer({
  filtered,
  layerState,
  metrics,
  selected,
  communicationProjection,
  setSelected,
  setSelectedRouteId,
  variant = 'street',
}) {
  const layerRef = useRef(null);
  const dragRef = useRef(null);
  const [size, setSize] = useState({ width: 1000, height: 620 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoomDelta, setZoomDelta] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!layerRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ width, height });
      }
    });
    observer.observe(layerRef.current);
    return () => observer.disconnect();
  }, []);

  const bounds = expandBounds(computeRouteBounds(filtered) || computeDataBounds(filtered), 0.015);
  if (!bounds || !filtered?.routes) {
    return null;
  }

  const center = {
    lon: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  };
  const baseZoom = chooseStreetMapZoom(bounds, size.width, size.height);
  const zoom = clampZoom(baseZoom + zoomDelta);
  const centerWorld = lonLatToWorld(center.lon, center.lat, zoom);
  const tilePadding = STREET_MAP_TILE_PADDING;
  const viewLeftWorld = centerWorld.x - size.width / 2 - pan.x;
  const viewRightWorld = centerWorld.x + size.width / 2 - pan.x;
  const viewTopWorld = centerWorld.y - size.height / 2 - pan.y;
  const viewBottomWorld = centerWorld.y + size.height / 2 - pan.y;
  const visibleMinTileX = Math.floor(viewLeftWorld / 256);
  const visibleMaxTileX = Math.floor((viewRightWorld - 1) / 256);
  const visibleMinTileY = Math.floor(viewTopWorld / 256);
  const visibleMaxTileY = Math.floor((viewBottomWorld - 1) / 256);
  const minTileX = visibleMinTileX - tilePadding;
  const maxTileX = visibleMaxTileX + tilePadding;
  const minTileY = visibleMinTileY - tilePadding;
  const maxTileY = visibleMaxTileY + tilePadding;
  const tileCount = 2 ** zoom;
  const tiles = [];
  const visibleCenterTile = {
    x: (visibleMinTileX + visibleMaxTileX + 1) / 2,
    y: (visibleMinTileY + visibleMaxTileY + 1) / 2,
  };

  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      const visible = x >= visibleMinTileX && x <= visibleMaxTileX && y >= visibleMinTileY && y <= visibleMaxTileY;
      const outsideRing = Math.max(
        visibleMinTileX - x,
        x - visibleMaxTileX,
        visibleMinTileY - y,
        y - visibleMaxTileY,
        0,
      );
      const distanceFromCenter = Math.hypot((x + 0.5) - visibleCenterTile.x, (y + 0.5) - visibleCenterTile.y);
      tiles.push({
        key: `${zoom}-${x}-${y}`,
        src: OSM_TILE_URL
          .replace('{z}', zoom)
          .replace('{x}', wrappedX)
          .replace('{y}', y),
        left: Math.round(x * 256 - centerWorld.x + size.width / 2 + pan.x),
        top: Math.round(y * 256 - centerWorld.y + size.height / 2 + pan.y),
        visible,
        loading: visible ? 'eager' : 'lazy',
        fetchPriority: visible ? 'high' : 'low',
        sortWeight: visible ? distanceFromCenter : 1000 + outsideRing * 100 + distanceFromCenter,
      });
    }
  }
  tiles.sort((left, right) => left.sortWeight - right.sortWeight);

  const project = ([lon, lat]) => {
    const world = lonLatToWorld(lon, lat, zoom);
    return {
      x: world.x - centerWorld.x + size.width / 2 + pan.x,
      y: world.y - centerWorld.y + size.height / 2 + pan.y,
    };
  };
  const toPoints = (coordinates) => coordinates.map((coordinate) => {
    const point = project(coordinate);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');
  const projectionPoint = (point) => project([point.lon, point.lat]);
  const selectionValue = (selection) => encodeURIComponent(JSON.stringify(selection));
  const activateSelection = (event, selection) => {
    event.stopPropagation();
    setSelected(selection);
  };
  const startPan = (event) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.('[data-selection]')) return;
    if (event.target?.closest?.('.street-map-controls')) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const movePan = (event) => {
    if (!dragRef.current) return;
    event.preventDefault();
    setPan({
      x: dragRef.current.panX + event.clientX - dragRef.current.startX,
      y: dragRef.current.panY + event.clientY - dragRef.current.startY,
    });
  };
  const endPan = (event) => {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture?.(dragRef.current.pointerId);
    dragRef.current = null;
    setDragging(false);
  };
  const zoomIn = () => setZoomDelta((current) => clampZoom(baseZoom + current + 1) - baseZoom);
  const zoomOut = () => setZoomDelta((current) => clampZoom(baseZoom + current - 1) - baseZoom);
  const resetView = () => {
    setPan({ x: 0, y: 0 });
    setZoomDelta(0);
  };
  const handleWheel = (event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setZoomDelta((current) => clampZoom(baseZoom + current + direction) - baseZoom);
  };
  const resetPan = (event) => {
    if (event.target?.closest?.('[data-selection]')) return;
    resetView();
  };

  return (
    <div
      ref={layerRef}
      className={`${variant === 'terrain' ? 'terrain-map-layer' : 'street-map-layer'} ${dragging ? 'dragging' : ''}`}
      aria-label="真实地图底图"
      onDoubleClick={resetPan}
      onPointerCancel={endPan}
      onPointerDown={startPan}
      onPointerLeave={endPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onWheel={handleWheel}
    >
      <div className="street-map-controls" aria-label="地图缩放控件">
        <button type="button" onClick={zoomIn} aria-label="放大地图">+</button>
        <button type="button" onClick={zoomOut} aria-label="缩小地图">-</button>
        <button type="button" onClick={resetView} aria-label="重置地图视图">⟳</button>
        <span className="street-map-zoom-level">Z{zoom}</span>
      </div>
      <div className="street-map-tiles">
        {tiles.map((tile) => (
          <img
            alt=""
            draggable="false"
            fetchPriority={tile.fetchPriority}
            key={tile.key}
            loading={tile.loading}
            decoding="async"
            src={tile.src}
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>
      <svg className="street-map-vectors" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
        {layerState.lines && (filtered.lines?.features || []).map((feature, index) => (
          <polyline
            className={`street-line ${isSelectedFeature(selected, '线路候选', feature.properties, 'line_id') ? 'selected' : ''}`}
            key={`line-${index}`}
            points={toPoints(feature.geometry.coordinates || [])}
            data-selection={selectionValue({ title: '线路候选', properties: feature.properties || {} })}
            onPointerDown={(event) => activateSelection(event, { title: '线路候选', properties: feature.properties || {} })}
            onClick={(event) => activateSelection(event, { title: '线路候选', properties: feature.properties || {} })}
          />
        ))}
        {layerState.routes && (filtered.routes?.features || []).map((feature, index) => {
          const props = feature.properties || {};
          const metric = metrics.find((item) => item.route_id === props.route_id);
          const routeSelection = buildRouteSelection(feature, metric, 'DOM map overlay');
          const coordinates = feature.geometry.coordinates || [];
          const badge = coordinates.length ? project(coordinates[Math.floor(coordinates.length / 2)]) : null;
          const routeSelected = isSelectedFeature(selected, 'KML 航线', props, 'route_id');
          const selectRoute = (event) => {
            activateSelection(event, routeSelection);
            setSelectedRouteId?.(props.route_id);
          };
          return (
            <g key={props.route_id || `route-${index}`}>
              <polyline
                className="street-route-hit"
                points={toPoints(coordinates)}
                data-selection={selectionValue(routeSelection)}
                onPointerDown={selectRoute}
                onClick={selectRoute}
              />
              <polyline
                className={`street-route ${routeSelected ? 'selected' : ''}`}
                points={toPoints(coordinates)}
                style={{ stroke: routeColorHexes[index % routeColorHexes.length] }}
                data-selection={selectionValue(routeSelection)}
                onPointerDown={selectRoute}
                onClick={selectRoute}
              />
              {badge && (
                <g className={`street-route-badge ${routeSelected ? 'selected' : ''}`} transform={`translate(${badge.x.toFixed(1)} ${badge.y.toFixed(1)})`} onClick={selectRoute}>
                  <rect className="street-route-badge-fill" x="-32" y="-15" width="64" height="30" rx="6" data-selection={selectionValue(routeSelection)} onPointerDown={selectRoute} />
                  <text x="0" y="5">航线{index + 1}</text>
                </g>
              )}
            </g>
          );
        })}
        {layerState.communication && communicationProjection?.source && communicationProjection?.currentPoint && (
          <CommunicationProjectionOverlay
            activateSelection={activateSelection}
            projection={communicationProjection}
            project={projectionPoint}
            selectionValue={selectionValue}
          />
        )}
        {layerState.waypoints && (filtered.waypoints?.features || []).map((feature, index) => {
          const props = feature.properties || {};
          const metric = metrics.find((item) => item.route_id === props.route_id);
          const point = project(feature.geometry.coordinates);
          const selection = buildWaypointSelection(feature, metric);
          const waypointSelected = isSelectedFeature(selected, '航点', props, 'waypoint_id');
          const selectWaypoint = (event) => {
            activateSelection(event, selection);
            setSelectedRouteId?.(props.route_id);
          };
          return (
            <g className={`street-waypoint-group ${waypointSelected ? 'selected' : ''}`} key={props.waypoint_id || `wp-${index}`}>
              <circle
                className="street-waypoint-hit"
                cx={point.x}
                cy={point.y}
                r="13"
                data-selection={selectionValue(selection)}
                onPointerDown={selectWaypoint}
                onClick={selectWaypoint}
              />
              <circle
                className="street-waypoint"
                cx={point.x}
                cy={point.y}
                r="6"
                data-selection={selectionValue(selection)}
                onPointerDown={selectWaypoint}
                onClick={selectWaypoint}
              />
            </g>
          );
        })}
        {layerState.towers && (filtered.towers?.features || []).map((feature, index) => {
          const point = project(feature.geometry.coordinates);
          const towerSelection = buildTowerSelection(feature);
          return (
            <circle
              className={`street-tower ${isSelectedFeature(selected, '杆塔', feature.properties, 'tower_id') ? 'selected' : ''}`}
              key={feature.properties?.tower_id || `tower-${index}`}
              cx={point.x}
              cy={point.y}
              r="5.5"
              data-selection={selectionValue(towerSelection)}
              onPointerDown={(event) => activateSelection(event, towerSelection)}
              onClick={(event) => activateSelection(event, towerSelection)}
            />
          );
        })}
        {layerState.stations && (filtered.baseStations?.features || []).map((feature, index) => {
          const point = project(feature.geometry.coordinates);
          return (
            <path
              className={`street-station ${isSelectedFeature(selected, '基站/机场候选', feature.properties, 'station_id') ? 'selected' : ''}`}
              key={feature.properties?.station_id || `station-${index}`}
              d={`M ${point.x} ${point.y - 11} L ${point.x + 10} ${point.y + 8} L ${point.x - 10} ${point.y + 8} Z`}
              data-selection={selectionValue({ title: '基站/机场候选', properties: feature.properties || {} })}
              onPointerDown={(event) => activateSelection(event, { title: '基站/机场候选', properties: feature.properties || {} })}
              onClick={(event) => activateSelection(event, { title: '基站/机场候选', properties: feature.properties || {} })}
            />
          );
        })}
      </svg>
    </div>
  );
}

function CommunicationProjectionOverlay({ projection, project, activateSelection, selectionValue }) {
  const source = projection.source;
  const target = projection.currentPoint;
  const sourcePoint = project(source);
  const targetPoint = project(target);
  const routeSamples = Array.isArray(projection.routeSamples) ? projection.routeSamples : [];
  const profileSamples = Array.isArray(projection.currentProfile) ? projection.currentProfile : [];
  const worstPoint = projection.worstPoint ? project(projection.worstPoint) : null;
  const footprintWidth = Math.min(Math.max(Number(projection.currentFresnelRadiusM || 10) * 0.7, 12), 34);
  const projectionSelection = {
    title: '通信遮挡演示',
    properties: {
      analysis_type: 'mountain_communication_visual',
      role: '2D map projection',
      status: projection.label || '',
      source_station: source.stationId || '',
      kml_file: projection.kml_file || '',
      route_id: projection.route_id || '',
      waypoint: projection.waypoint || '',
      link_distance_m: Number(projection.currentDistanceM?.toFixed?.(1) ?? projection.currentDistanceM ?? 0),
      fresnel_radius_m: Number(projection.currentFresnelRadiusM?.toFixed?.(1) ?? 0),
      terrain_samples: projection.terrainSampleCoverage || '',
      worst_clearance_m: Number.isFinite(projection.worstClearanceM)
        ? Number(projection.worstClearanceM.toFixed(1))
        : 'terrain pending',
      model: 'same communication diagnostic projected onto 2D map',
      data_boundary: 'visual projection only; not measured communication coverage or engineering DEM result',
    },
  };
  const handleSelect = (event) => activateSelection(event, projectionSelection);

  return (
    <g className={`street-communication-projection risk-${projection.status || 'visual_only'}`}>
      {routeSamples.map((sample, index) => {
        const point = project(sample.point);
        return (
          <line
            className={`street-communication-spoke risk-${sample.status || 'visual_only'}`}
            data-selection={selectionValue(projectionSelection)}
            key={`comm-spoke-${index}`}
            onClick={handleSelect}
            onPointerDown={handleSelect}
            x1={sourcePoint.x}
            y1={sourcePoint.y}
            x2={point.x}
            y2={point.y}
          />
        );
      })}
      <line
        className={`street-communication-footprint risk-${projection.status || 'visual_only'}`}
        data-selection={selectionValue(projectionSelection)}
        onClick={handleSelect}
        onPointerDown={handleSelect}
        style={{ strokeWidth: footprintWidth }}
        x1={sourcePoint.x}
        y1={sourcePoint.y}
        x2={targetPoint.x}
        y2={targetPoint.y}
      />
      <line
        className={`street-communication-current risk-${projection.status || 'visual_only'}`}
        data-selection={selectionValue(projectionSelection)}
        onClick={handleSelect}
        onPointerDown={handleSelect}
        x1={sourcePoint.x}
        y1={sourcePoint.y}
        x2={targetPoint.x}
        y2={targetPoint.y}
      />
      {profileSamples.map((sample, index) => {
        const point = project(sample);
        return (
          <circle
            className={`street-communication-sample risk-${sample.status || 'visual_only'}`}
            cx={point.x}
            cy={point.y}
            data-selection={selectionValue(projectionSelection)}
            key={`comm-sample-${index}`}
            onClick={handleSelect}
            onPointerDown={handleSelect}
            r={sample.status === 'nlos' ? 6 : sample.status === 'fresnel_risk' ? 5 : 3.8}
          />
        );
      })}
      <circle
        className="street-communication-source"
        cx={sourcePoint.x}
        cy={sourcePoint.y}
        data-selection={selectionValue(projectionSelection)}
        onClick={handleSelect}
        onPointerDown={handleSelect}
        r="8"
      />
      <circle
        className={`street-communication-target risk-${projection.status || 'visual_only'}`}
        cx={targetPoint.x}
        cy={targetPoint.y}
        data-selection={selectionValue(projectionSelection)}
        onClick={handleSelect}
        onPointerDown={handleSelect}
        r="7"
      />
      {worstPoint && (
        <path
          className={`street-communication-worst risk-${projection.status || 'visual_only'}`}
          d={`M ${worstPoint.x - 8} ${worstPoint.y} L ${worstPoint.x} ${worstPoint.y - 8} L ${worstPoint.x + 8} ${worstPoint.y} L ${worstPoint.x} ${worstPoint.y + 8} Z`}
          data-selection={selectionValue(projectionSelection)}
          onClick={handleSelect}
          onPointerDown={handleSelect}
        />
      )}
      <text className="street-communication-label" x={(sourcePoint.x + targetPoint.x) / 2} y={(sourcePoint.y + targetPoint.y) / 2 - 18}>
        {projection.label || '通信投影'}
      </text>
    </g>
  );
}

function chooseStreetMapZoom(bounds, width, height) {
  for (let zoom = 16; zoom >= 8; zoom -= 1) {
    const nw = lonLatToWorld(bounds.west, bounds.north, zoom);
    const se = lonLatToWorld(bounds.east, bounds.south, zoom);
    if (Math.abs(se.x - nw.x) <= width * 0.72 && Math.abs(se.y - nw.y) <= height * 0.72) {
      return zoom;
    }
  }
  return 10;
}

function clampZoom(zoom) {
  return Math.min(Math.max(zoom, STREET_MAP_MIN_ZOOM), STREET_MAP_MAX_ZOOM);
}

function lonLatToWorld(lon, lat, zoom) {
  const sinLat = Math.sin(Cesium.Math.toRadians(Math.max(Math.min(lat, 85.05112878), -85.05112878)));
  const scale = 256 * (2 ** zoom);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

async function configureMapMode(viewer, setMapStatus, mode, exaggeration) {
  const scene = await waitForViewerScene(viewer);
  if (!scene) {
    setMapStatus((current) => ({
      ...current,
      mapMode: mode,
      lastMapLoadingError: current.lastMapLoadingError || 'Cesium viewer scene is not ready',
    }));
    return;
  }
  applyTerrainExaggeration(viewer, exaggeration);
  clearMapModeArtifacts(viewer);
  setMapStatus((current) => ({
    ...current,
    mapMode: mode,
    terrainExaggeration: `${exaggeration}x`,
    lastMapLoadingError: '',
  }));

  if (mode === MAP_MODES.BASIC_GRID) {
    setEllipsoidTerrain(viewer);
    applyTerrainVisualMaterial(viewer, false, setMapStatus);
    addFallbackGridImagery(viewer, setMapStatus, 'Fallback basic scene');
    setMapStatus((current) => ({
      ...current,
      terrain: 'fallback basic scene',
      terrainProvider: getTerrainProviderName(viewer),
      imageryProvider: getImageryProviderName(viewer),
      tilesProvider: 'not configured',
    }));
    return;
  }

  if (mode === MAP_MODES.PHOTOREALISTIC_3D_TILES) {
    await configureThreeDimensionalTilesMode(viewer, setMapStatus);
    return;
  }

  if (mode === MAP_MODES.LOCAL_TERRAIN_FUTURE) {
    setEllipsoidTerrain(viewer);
    applyTerrainVisualMaterial(viewer, false, setMapStatus);
    addFallbackGridImagery(viewer, setMapStatus, 'Fallback basic scene');
    setMapStatus((current) => ({
      ...current,
      mapMode: MAP_MODES.LOCAL_TERRAIN_FUTURE,
      terrain: 'fallback basic scene',
      lastMapLoadingError: 'local terrain tiles are reserved for a future DEM/terrain source',
    }));
    return;
  }

  if (mode === MAP_MODES.TERRAIN_IMAGERY) {
    setEllipsoidTerrain(viewer);
    applyTerrainVisualMaterial(viewer, false, setMapStatus);
    viewer.__taishanTerrainVisual = '2D map overlay; no contour material';
    getViewerImageryLayersSafe(viewer)?.removeAll();
    scene.globe.show = true;
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#dce9e3');
    setMapStatus((current) => ({
      ...current,
      basemap: '2D OpenStreetMap overlay',
      terrain: '2D ellipsoid surface',
      terrainProvider: getTerrainProviderName(viewer),
      imageryProvider: 'DOM OpenStreetMap tiles',
      tilesProvider: 'not configured',
      terrainVisual: '2D map overlay; no contour material',
      lastMapLoadingError: '',
      lastError: '',
    }));
    scene.requestRender();
    flyToTerrainView(viewer, null, setMapStatus);
    return;
  }

  await tryCesiumIonTerrain(viewer, setMapStatus);
  const imageryLoaded = await tryPreferredImagery(viewer, setMapStatus);
  if (!imageryLoaded) {
    addFallbackGridImagery(viewer, setMapStatus, 'Fallback basic scene');
  }
  setMapStatus((current) => ({
    ...current,
    tilesProvider: 'not configured',
    terrainProvider: getTerrainProviderName(viewer),
    imageryProvider: getImageryProviderName(viewer),
  }));
  applyTerrainVisualMaterial(viewer, true, setMapStatus);
  flyToTerrainView(viewer, null, setMapStatus);
  warmVisibleTiles(viewer, CESIUM_TILE_WARMUP_MS);
}

async function configureThreeDimensionalTilesMode(viewer, setMapStatus) {
  configureCameraControls(viewer);
  viewer.scene.globe.show = true;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0b1220');
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#345c63');

  await tryCesiumIonTerrain(viewer, setMapStatus);

  const imageryLoaded = await tryPreferredImagery(viewer, setMapStatus);
  if (!imageryLoaded) {
    addFallbackGridImagery(viewer, setMapStatus, 'Fallback basic scene');
  }

  const googleTilesLoaded = await tryGooglePhotorealisticTiles(viewer, setMapStatus);
  setMapStatus((current) => ({
    ...current,
    mapMode: MAP_MODES.PHOTOREALISTIC_3D_TILES,
    basemap: googleTilesLoaded ? 'Google Photorealistic 3D Tiles + imagery' : current.basemap,
    terrainProvider: getTerrainProviderName(viewer),
    imageryProvider: getImageryProviderName(viewer),
    tilesProvider: googleTilesLoaded ? 'Google Photorealistic 3D Tiles' : 'not configured; Cesium 3D terrain/imagery active',
    google3dTiles: googleTilesLoaded ? 'configured' : current.google3dTiles,
    lastMapLoadingError: googleTilesLoaded
      ? current.lastMapLoadingError
      : current.lastMapLoadingError?.startsWith('Google Photorealistic 3D Tiles is not configured')
        ? ''
        : current.lastMapLoadingError,
  }));
  applyTerrainVisualMaterial(viewer, true, setMapStatus);
  flyTo3DSceneView(viewer, null, setMapStatus);
  warmVisibleTiles(viewer, CESIUM_TILE_WARMUP_MS);
}

async function tryGooglePhotorealisticTiles(viewer, setMapStatus) {
  if (!USE_GOOGLE_3D_TILES || !GOOGLE_MAPS_API_KEY) {
    setMapStatus((current) => ({
      ...current,
      google3dTiles: 'not configured',
      tilesProvider: 'not configured; Cesium 3D terrain/imagery active',
      mapMode: MAP_MODES.PHOTOREALISTIC_3D_TILES,
      lastMapLoadingError: current.lastMapLoadingError,
    }));
    return false;
  }
  try {
    if (viewer.__taishanTileset) {
      viewer.scene.primitives.remove(viewer.__taishanTileset);
      viewer.__taishanTileset = null;
    }
    const tileset = await Cesium.Cesium3DTileset.fromUrl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`,
    );
    viewer.scene.primitives.add(tileset);
    viewer.__taishanTileset = tileset;
    viewer.scene.frameState.creditDisplay.addStaticCredit(new Cesium.Credit('Google Photorealistic 3D Tiles'));
    setMapStatus((current) => ({
      ...current,
      basemap: 'Google Photorealistic 3D Tiles',
      google3dTiles: 'configured',
      tilesProvider: 'Google Photorealistic 3D Tiles',
      mapMode: MAP_MODES.PHOTOREALISTIC_3D_TILES,
      lastError: current.lastError,
    }));
    return true;
  } catch (error) {
    setMapStatus((current) => ({
      ...current,
      google3dTiles: 'failed',
      tilesProvider: 'failed',
      mapMode: MAP_MODES.PHOTOREALISTIC_3D_TILES,
      lastMapLoadingError: `Google 3D Tiles failed: ${error.message}`,
      lastError: `Google 3D Tiles failed: ${error.message}`,
    }));
    return false;
  }
}

async function tryCesiumIonTerrain(viewer, setMapStatus) {
  if (!CESIUM_ION_TOKEN) {
    setEllipsoidTerrain(viewer);
    setMapStatus((current) => ({
      ...current,
      terrain: 'fallback basic scene',
      cesiumIon: 'not configured',
      terrainProvider: getTerrainProviderName(viewer),
      lastTerrainError: '',
    }));
    return;
  }

  if (!USE_CESIUM_WORLD_TERRAIN) {
    setEllipsoidTerrain(viewer);
    setMapStatus((current) => ({
      ...current,
      terrain: 'Ellipsoid terrain',
      cesiumIon: 'configured',
      terrainProvider: getTerrainProviderName(viewer),
      lastTerrainError: '',
    }));
    return;
  }

  try {
    await loadCesiumWorldTerrain(viewer, setMapStatus);
    const scene = getViewerSceneSafe(viewer);
    if (!scene) return;
    scene.globe.depthTestAgainstTerrain = false;
    // Cesium sun lighting can make the current China view look fully dark at night; keep map tiles unshaded.
    scene.globe.enableLighting = false;
    setMapStatus((current) => ({
      ...current,
      terrain: 'Cesium World Terrain',
      cesiumIon: 'configured',
      terrainProvider: getTerrainProviderName(viewer),
      lastTerrainError: '',
    }));
  } catch (error) {
    setEllipsoidTerrain(viewer);
    setMapStatus((current) => ({
      ...current,
      terrain: 'Ellipsoid terrain',
      cesiumIon: 'failed',
      terrainProvider: getTerrainProviderName(viewer),
      lastTerrainError: `Cesium World Terrain failed: ${formatCesiumError(error)}`,
      lastMapLoadingError: `Cesium World Terrain failed: ${formatCesiumError(error)}`,
      lastError: `Cesium World Terrain failed: ${formatCesiumError(error)}`,
    }));
  }
}

function setEllipsoidTerrain(viewer) {
  let scene = null;
  try {
    scene = viewer?._cesiumWidget?.scene || viewer?.scene || null;
  } catch {
    return;
  }
  if (scene) {
    scene.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  }
}

async function loadCesiumWorldTerrain(viewer, setMapStatus) {
  const options = {
    requestVertexNormals: true,
    requestWaterMask: true,
  };
  const scene = getViewerSceneSafe(viewer);
  if (!scene) {
    throw new Error('Cesium viewer scene is not available');
  }
  if (Cesium.Terrain?.fromWorldTerrain && typeof scene.setTerrain === 'function') {
    const terrain = Cesium.Terrain.fromWorldTerrain(options);
    scene.setTerrain(terrain);
    terrain.errorEvent.addEventListener((error) => {
      if (handleTransientTileAvailability(error, setMapStatus)) return;
      setEllipsoidTerrain(viewer);
      setMapStatus((current) => ({
        ...current,
        terrain: 'Ellipsoid terrain',
        cesiumIon: 'failed',
        lastTerrainError: `Cesium World Terrain failed: ${formatCesiumError(error)}`,
        lastError: `Cesium World Terrain failed: ${formatCesiumError(error)}`,
      }));
    });
    await waitForTerrainReady(terrain);
    return terrain.provider;
  }
  if (typeof Cesium.createWorldTerrainAsync === 'function') {
    const provider = await Cesium.createWorldTerrainAsync(options);
    viewer.terrainProvider = provider;
    attachTerrainProviderError(provider, viewer, setMapStatus);
    return provider;
  }
  const legacyCreateWorldTerrain = Cesium[`create${'WorldTerrain'}`];
  if (typeof legacyCreateWorldTerrain === 'function') {
    const provider = legacyCreateWorldTerrain(options);
    viewer.terrainProvider = provider;
    attachTerrainProviderError(provider, viewer, setMapStatus);
    return provider;
  }
  throw new Error('Cesium World Terrain API is not available in this Cesium build');
}

function waitForTerrainReady(terrain) {
  if (terrain.ready) {
    return Promise.resolve(terrain.provider);
  }
  return new Promise((resolve, reject) => {
    const removeReady = terrain.readyEvent.addEventListener((provider) => {
      removeReady();
      removeError?.();
      resolve(provider);
    });
    const removeError = terrain.errorEvent.addEventListener((error) => {
      if (isTransientTileAvailabilityError(error)) {
        markTileErrorForRetry(error);
        return;
      }
      removeReady();
      removeError();
      reject(error);
    });
  });
}

function attachTerrainProviderError(provider, viewer, setMapStatus) {
  provider?.errorEvent?.addEventListener((error) => {
    if (handleTransientTileAvailability(error, setMapStatus)) return;
    setEllipsoidTerrain(viewer);
    setMapStatus((current) => ({
      ...current,
      terrain: 'Ellipsoid terrain',
      cesiumIon: 'failed',
      lastTerrainError: `Cesium World Terrain failed: ${formatCesiumError(error)}`,
      lastError: `Cesium World Terrain failed: ${formatCesiumError(error)}`,
    }));
  });
}

function clearMapModeArtifacts(viewer) {
  if (!viewer) return;
  const scene = getViewerSceneSafe(viewer);
  if (!scene) return;
  if (viewer.__taishanTileset) {
    scene.primitives.remove(viewer.__taishanTileset);
    viewer.__taishanTileset = null;
  }
  getViewerImageryLayersSafe(viewer)?.removeAll();
  scene.requestRender();
}

function formatCesiumError(error) {
  if (!error) return 'unknown error';
  return error.message || error.error?.message || error.toString?.() || String(error);
}

function isTransientTileAvailabilityError(error) {
  const message = formatCesiumError(error).toLowerCase();
  return message.includes('map data not yet available')
    || message.includes('not yet available')
    || message.includes('tile is not available')
    || message.includes('tile not available')
    || message.includes('failed to obtain image tile')
    || message.includes('request throttled');
}

function markTileErrorForRetry(error) {
  if (!error || typeof error !== 'object') return;
  const retryCount = Number(error.timesRetried || 0);
  if (retryCount < 5) {
    error.retry = true;
  }
}

function isTransientTileErrorText(value) {
  return /map data not yet available|not yet available|tile is not available|tile not available|failed to obtain image tile|request throttled/i
    .test(String(value || ''));
}

function isMapLoadingErrorText(value) {
  return isTransientTileErrorText(value)
    || /imagery failed|tile failed|render error recovered|failed with fallback grid|failed to obtain image tile|cannot read properties of undefined \(reading 'scene'\)/i
      .test(String(value || ''));
}

function clearTransientTileErrorStatus(current) {
  return {
    ...current,
    lastMapLoadingError: isTransientTileErrorText(current.lastMapLoadingError) ? '' : current.lastMapLoadingError,
    lastTerrainError: isTransientTileErrorText(current.lastTerrainError) ? '' : current.lastTerrainError,
    lastError: isTransientTileErrorText(current.lastError) ? '' : current.lastError,
  };
}

function clearRecoveredMapLoadingStatus(current) {
  return {
    ...current,
    lastMapLoadingError: isMapLoadingErrorText(current.lastMapLoadingError) ? '' : current.lastMapLoadingError,
    lastError: isMapLoadingErrorText(current.lastError) ? '' : current.lastError,
  };
}

function handleTransientTileAvailability(error, setMapStatus) {
  if (!isTransientTileAvailabilityError(error)) return false;
  markTileErrorForRetry(error);
  setMapStatus?.((current) => clearTransientTileErrorStatus(current));
  return true;
}

async function recoverFromMapRenderError(viewer, setMapStatus, error) {
  const message = formatCesiumError(error);
  if (handleTransientTileAvailability(error, setMapStatus)) return;
  if (viewer.__recoveringMapRenderError) return;
  viewer.__recoveringMapRenderError = true;
  try {
    const osmLoaded = await tryOsmImagery(viewer, setMapStatus, `Render error recovered from imagery: ${message}`);
    if (!osmLoaded) {
      addFallbackGridImagery(viewer, setMapStatus, 'Fallback basic scene');
      setMapStatus((current) => ({
        ...current,
        basemap: 'Fallback basic scene',
        imageryProvider: 'fallback grid',
        lastMapLoadingError: `Render error recovered with fallback grid: ${message}`,
        lastError: `Render error recovered with fallback grid: ${message}`,
      }));
    }
  } finally {
    viewer.useDefaultRenderLoop = true;
    viewer.__recoveringMapRenderError = false;
    updateCameraStatus(viewer, setMapStatus);
    getViewerSceneSafe(viewer)?.requestRender();
  }
}

async function tryPreferredImagery(viewer, setMapStatus) {
  const orderedLoaders = [];
  if (PREFERRED_IMAGERY_SOURCE === 'ion' && CESIUM_ION_TOKEN) {
    orderedLoaders.push(tryCesiumIonImagery, tryOsmImagery, tryPublicTopoImagery);
  } else if (PREFERRED_IMAGERY_SOURCE === 'arcgis') {
    orderedLoaders.push(tryPublicTopoImagery, tryOsmImagery);
    if (CESIUM_ION_TOKEN) orderedLoaders.push(tryCesiumIonImagery);
  } else {
    orderedLoaders.push(tryOsmImagery);
    if (CESIUM_ION_TOKEN) orderedLoaders.push(tryCesiumIonImagery);
    orderedLoaders.push(tryPublicTopoImagery);
  }

  for (const loadImagery of orderedLoaders) {
    const loaded = await loadImagery(viewer, setMapStatus);
    if (loaded) return true;
  }
  return false;
}

async function tryPublicTopoImagery(viewer, setMapStatus) {
  try {
    const imageryLayers = getViewerImageryLayersSafe(viewer);
    const scene = getViewerSceneSafe(viewer);
    if (!imageryLayers || !scene) {
      throw new Error('Cesium imagery layer collection is not available');
    }
    imageryLayers.removeAll();
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: ARCGIS_TOPO_TILE_URL,
      credit: 'Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors',
      maximumLevel: 19,
    });
    imageryLayers.addImageryProvider(provider);
    provider.errorEvent?.addEventListener((tileProviderError) => {
      if (handleTransientTileAvailability(tileProviderError, setMapStatus)) return;
      setMapStatus((current) => ({
        ...current,
        basemap: 'ArcGIS World Topographic Map',
        imageryProvider: 'ArcGIS World Topo',
        lastMapLoadingError: `ArcGIS topo tile failed: ${formatCesiumError(tileProviderError)}`,
        lastError: `ArcGIS topo tile failed: ${formatCesiumError(tileProviderError)}`,
      }));
    });
    setMapStatus((current) => ({
      ...clearRecoveredMapLoadingStatus(current),
      basemap: 'ArcGIS World Topographic Map',
      imageryProvider: 'ArcGIS World Topo',
    }));
    scene.requestRender();
    return true;
  } catch (error) {
    setMapStatus((current) => ({
      ...current,
      basemap: 'public topo failed',
      imageryProvider: getImageryProviderName(viewer),
      lastMapLoadingError: `ArcGIS topo imagery failed: ${formatCesiumError(error)}`,
      lastError: `ArcGIS topo imagery failed: ${formatCesiumError(error)}`,
    }));
    return false;
  }
}

async function tryCesiumIonImagery(viewer, setMapStatus) {
  if (!CESIUM_ION_TOKEN) {
    setMapStatus((current) => ({
      ...current,
      imageryProvider: getImageryProviderName(viewer),
      lastMapLoadingError: current.lastMapLoadingError || 'Cesium ion token is not configured; imagery fallback is required',
    }));
    return false;
  }
  try {
    const provider = typeof Cesium.createWorldImageryAsync === 'function'
      ? await Cesium.createWorldImageryAsync()
      : await Cesium.IonImageryProvider.fromAssetId(2);
    const providerName = provider?.constructor?.name || 'Cesium ion imagery';
    const imageryLayers = getViewerImageryLayersSafe(viewer);
    const scene = getViewerSceneSafe(viewer);
    if (!imageryLayers || !scene) {
      throw new Error('Cesium imagery layer collection is not available');
    }
    imageryLayers.removeAll();
    imageryLayers.addImageryProvider(provider);
    provider.errorEvent?.addEventListener((tileProviderError) => {
      if (handleTransientTileAvailability(tileProviderError, setMapStatus)) return;
      setMapStatus((current) => ({
        ...current,
        basemap: 'Cesium ion imagery',
        imageryProvider: providerName,
        lastMapLoadingError: `Cesium ion imagery tile failed: ${formatCesiumError(tileProviderError)}`,
        lastError: `Cesium ion imagery tile failed: ${formatCesiumError(tileProviderError)}`,
      }));
    });
    setMapStatus((current) => ({
      ...clearRecoveredMapLoadingStatus(current),
      basemap: 'Cesium ion imagery',
      cesiumIon: 'configured',
      imageryProvider: providerName,
    }));
    scene.requestRender();
    return true;
  } catch (error) {
    setMapStatus((current) => ({
      ...current,
      cesiumIon: 'failed',
      imageryProvider: getImageryProviderName(viewer),
      lastMapLoadingError: `Cesium ion imagery failed: ${formatCesiumError(error)}`,
      lastError: `Cesium ion imagery failed: ${formatCesiumError(error)}`,
    }));
    return false;
  }
}

async function tryOsmImagery(viewer, setMapStatus, reason = '') {
  if (!USE_OSM_FALLBACK) {
    setMapStatus((current) => ({
      ...current,
      basemap: 'Fallback basic scene',
      imageryProvider: getImageryProviderName(viewer),
      lastMapLoadingError: reason || current.lastMapLoadingError || 'OSM fallback is disabled',
    }));
    return false;
  }
  try {
    const imageryLayers = getViewerImageryLayersSafe(viewer);
    const scene = getViewerSceneSafe(viewer);
    if (!imageryLayers || !scene) {
      throw new Error('Cesium imagery layer collection is not available');
    }
    imageryLayers.removeAll();
    const provider = new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
      credit: '© OpenStreetMap contributors',
    });
    imageryLayers.addImageryProvider(provider);
    provider.errorEvent.addEventListener((tileProviderError) => {
      if (handleTransientTileAvailability(tileProviderError, setMapStatus)) return;
      setMapStatus((current) => ({
        ...current,
        basemap: 'OSM',
        imageryProvider: 'OpenStreetMapImageryProvider',
        lastMapLoadingError: `OSM tile failed: ${formatCesiumError(tileProviderError)}`,
        lastError: `OSM tile failed: ${formatCesiumError(tileProviderError)}`,
      }));
    });
    setMapStatus((current) => {
      const cleaned = clearRecoveredMapLoadingStatus(current);
      const keepReason = reason && !isMapLoadingErrorText(reason);
      return {
        ...cleaned,
        basemap: 'OSM',
        imageryProvider: 'OpenStreetMapImageryProvider',
        lastMapLoadingError: keepReason ? reason : cleaned.lastMapLoadingError,
        lastError: keepReason ? reason : cleaned.lastError,
      };
    });
    scene.requestRender();
    return true;
  } catch (error) {
    addFallbackGridImagery(viewer, setMapStatus, 'Fallback basic scene');
    setMapStatus((current) => ({
      ...current,
      basemap: 'Fallback basic scene',
      imageryProvider: 'fallback grid',
      lastMapLoadingError: `OSM imagery failed: ${formatCesiumError(error)}`,
      lastError: `OSM imagery failed: ${formatCesiumError(error)}`,
    }));
    return false;
  }
}

function addFallbackGridImagery(viewer, setMapStatus, source) {
  const scene = getViewerSceneSafe(viewer);
  const imageryLayers = getViewerImageryLayersSafe(viewer);
  if (!scene || !imageryLayers) {
    setMapStatus((current) => ({
      ...current,
      basemap: source,
      terrain: current.terrain === 'Loading' ? 'Ellipsoid terrain' : current.terrain,
      imageryProvider: 'fallback grid unavailable',
      lastMapLoadingError: current.lastMapLoadingError || 'Cesium viewer scene is not available for fallback grid',
    }));
    return;
  }
  imageryLayers.removeAll();
  imageryLayers.addImageryProvider(new Cesium.GridImageryProvider({
    cells: 8,
    color: Cesium.Color.fromCssColorString('#d7fbff').withAlpha(0.55),
    glowColor: Cesium.Color.fromCssColorString('#54d2ff').withAlpha(0.18),
    backgroundColor: Cesium.Color.fromCssColorString('#234752').withAlpha(0.92),
    tileWidth: 256,
    tileHeight: 256,
  }));
  scene.globe.show = true;
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#315b69');
  setMapStatus((current) => ({
    ...current,
    basemap: source,
    terrain: current.terrain === 'Loading' ? 'Ellipsoid terrain' : current.terrain,
    imageryProvider: 'fallback grid',
    lastMapLoadingError: current.lastMapLoadingError,
  }));
  scene.requestRender();
}

function configureCameraControls(viewer) {
  const scene = getViewerSceneSafe(viewer);
  const controller = scene?.screenSpaceCameraController;
  if (!controller) return;
  controller.enableRotate = true;
  controller.enableTranslate = true;
  controller.enableZoom = true;
  controller.enableTilt = true;
  controller.enableLook = true;
  controller.enableCollisionDetection = false;
  controller.minimumZoomDistance = 60;
  controller.maximumZoomDistance = 450000;
}

function configureTileLoading(viewer) {
  const scene = getViewerSceneSafe(viewer);
  const globe = scene?.globe;
  if (!globe) return;

  // These settings only improve how aggressively Cesium keeps and preloads visible-area tiles.
  // They do not fabricate terrain/imagery and they do not make a global all-zoom offline cache.
  if ('tileCacheSize' in globe) {
    globe.tileCacheSize = Math.max(Number(globe.tileCacheSize) || 0, CESIUM_TILE_CACHE_SIZE);
  }
  if ('preloadAncestors' in globe) {
    globe.preloadAncestors = true;
  }
  if ('preloadSiblings' in globe) {
    globe.preloadSiblings = CESIUM_PRELOAD_SIBLINGS;
  }
  if ('maximumScreenSpaceError' in globe) {
    globe.maximumScreenSpaceError = CESIUM_MAXIMUM_SCREEN_SPACE_ERROR;
  }
  if ('loadingDescendantLimit' in globe) {
    globe.loadingDescendantLimit = Math.max(Number(globe.loadingDescendantLimit) || 0, 40);
  }
  viewer.__taishanTileCacheSize = globe.tileCacheSize;
  viewer.__taishanTileWarmupMs = CESIUM_TILE_WARMUP_MS;
  viewer.__taishanTileStrategy = `visible-first; sibling preload ${CESIUM_PRELOAD_SIBLINGS ? 'on' : 'off'}`;
  scene.requestRender();
}

function warmVisibleTiles(viewer, durationMs = 4500) {
  const scene = getViewerSceneSafe(viewer);
  if (!scene) return;
  clearTimeout(viewer.__taishanTileWarmupStop);
  if (viewer.__taishanTileWarmupFrame) {
    cancelAnimationFrame(viewer.__taishanTileWarmupFrame);
  }
  const startedAt = performance.now();
  const tick = () => {
    scene.requestRender();
    if (performance.now() - startedAt < durationMs) {
      viewer.__taishanTileWarmupFrame = requestAnimationFrame(tick);
    } else {
      viewer.__taishanTileWarmupFrame = null;
    }
  };
  viewer.__taishanTileWarmupFrame = requestAnimationFrame(tick);
}

function selectSceneObject(viewer, windowPosition, setSelected, setSelectedRouteId) {
  const direct = pickMetadataFromScene(viewer, windowPosition);
  if (direct) {
    setSelected(direct);
    syncSelectedRouteFromMetadata(direct, setSelectedRouteId);
    return;
  }
  const nearby = pickNearestEntityMetadata(viewer, windowPosition);
  if (nearby) {
    setSelected(nearby);
    syncSelectedRouteFromMetadata(nearby, setSelectedRouteId);
  }
}

function pickMetadataFromScene(viewer, windowPosition) {
  const scene = getViewerSceneSafe(viewer);
  if (!scene) return null;
  const picks = scene.drillPick(windowPosition, 12);
  const metadataItems = picks.map(getPickMetadata).filter(Boolean);
  const routeMetadata = metadataItems.find((metadata) => isRoutePickMetadata(metadata));
  if (routeMetadata) return routeMetadata;
  const communicationMetadata = metadataItems.find((metadata) => metadata.properties?.analysis_type === 'mountain_communication_visual');
  if (communicationMetadata) return communicationMetadata;
  const businessMetadata = metadataItems.find((metadata) => metadata.properties && !metadata.properties.analysis_type);
  if (businessMetadata) return businessMetadata;
  for (const pick of picks) {
    const metadata = getPickMetadata(pick);
    if (metadata) return metadata;
  }
  return getPickMetadata(scene.pick(windowPosition));
}

function isRoutePickMetadata(metadata) {
  const props = metadata?.properties || {};
  if (!props.route_id || props.analysis_type === 'mountain_communication_visual') return false;
  const title = String(metadata?.title || '');
  return Boolean(
    props.waypoint_id
    || props.kml_file
    || title.includes('KML')
    || title.includes('航线')
  );
}

function syncSelectedRouteFromMetadata(metadata, setSelectedRouteId) {
  const props = metadata?.properties || {};
  const routeId = props.route_id;
  if (routeId) {
    setSelectedRouteId?.(routeId);
  }
}

function getPickMetadata(pick) {
  if (!Cesium.defined(pick)) return null;
  const candidates = [
    pick.id,
    pick.primitive?.id,
    pick.collection?.id,
  ];
  for (const candidate of candidates) {
    if (candidate?.metadata) return candidate.metadata;
  }
  return null;
}

function pickNearestEntityMetadata(viewer, windowPosition) {
  const entities = viewer.__taishanPickableEntities || [];
  const scene = getViewerSceneSafe(viewer);
  if (!scene) return null;
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const entity of entities) {
    if (!entity.metadata) continue;
    const position = getEntityApproximateCartesian(entity, viewer.clock.currentTime);
    if (!position) continue;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, position);
    if (!screen) continue;
    const distance = Cesium.Cartesian2.distance(screen, windowPosition);
    if (distance < nearestDistance) {
      nearest = entity.metadata;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= 18 ? nearest : null;
}

function getEntityApproximateCartesian(entity, time) {
  const position = entity.position?.getValue?.(time);
  if (position) return position;
  const positions = entity.polyline?.positions?.getValue?.(time);
  if (positions?.length) return positions[Math.floor(positions.length / 2)];
  return null;
}

function applyTerrainExaggeration(viewer, exaggeration) {
  const scene = getViewerSceneSafe(viewer);
  if (!scene) return;
  const value = Number(exaggeration) || 1;
  if ('verticalExaggeration' in scene) {
    scene.verticalExaggeration = value;
  }
  if ('verticalExaggerationRelativeHeight' in scene) {
    scene.verticalExaggerationRelativeHeight = 0;
  }
  if ('terrainExaggeration' in scene.globe) {
    scene.globe.terrainExaggeration = value;
  }
  scene.requestRender();
}

function applyTerrainVisualMaterial(viewer, enabled, setMapStatus) {
  const scene = getViewerSceneSafe(viewer);
  const globe = scene?.globe;
  if (!globe) return;
  if (!enabled) {
    globe.material = undefined;
    viewer.__taishanTerrainVisual = 'basic grid only';
    setMapStatus?.((current) => ({ ...current, terrainVisual: 'basic grid only' }));
    scene.requestRender();
    return;
  }
  try {
    const materialType = Cesium.Material.ElevationContourType || 'ElevationContour';
    const material = Cesium.Material.fromType(materialType);
    material.uniforms.color = Cesium.Color.fromCssColorString('#f8fbff').withAlpha(0.62);
    material.uniforms.spacing = TERRAIN_CONTOUR_SPACING_M;
    material.uniforms.width = 1.4;
    globe.material = material;
    viewer.__taishanTerrainVisual = `visual contours ${TERRAIN_CONTOUR_SPACING_M} m, not engineering elevation`;
    setMapStatus?.((current) => ({
      ...current,
      terrainVisual: `contours ${TERRAIN_CONTOUR_SPACING_M} m visual only`,
    }));
  } catch (error) {
    globe.material = undefined;
    viewer.__taishanTerrainVisual = `contours unavailable: ${formatCesiumError(error)}`;
    setMapStatus?.((current) => ({
      ...current,
      terrainVisual: `contours unavailable: ${formatCesiumError(error)}`,
    }));
  }
  scene.requestRender();
}

function getViewerSceneSafe(viewer) {
  try {
    if (!viewer || viewer.__taishanDisposed || viewer.isDestroyed?.()) return null;
    return viewer?._cesiumWidget?.scene || viewer?.scene || null;
  } catch {
    return null;
  }
}

async function waitForViewerScene(viewer, timeoutMs = 2500) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const scene = getViewerSceneSafe(viewer);
    if (scene?.globe && scene?.camera) return scene;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return getViewerSceneSafe(viewer);
}

function getViewerImageryLayersSafe(viewer) {
  try {
    const scene = getViewerSceneSafe(viewer);
    return scene?.imageryLayers || viewer?.imageryLayers || null;
  } catch {
    return null;
  }
}

function getViewerCameraSafe(viewer) {
  try {
    const scene = getViewerSceneSafe(viewer);
    return scene?.camera || viewer?._cesiumWidget?.camera || null;
  } catch {
    return null;
  }
}

function getTerrainProviderName(viewer) {
  const scene = getViewerSceneSafe(viewer);
  const provider = scene?.terrainProvider;
  return provider?.constructor?.name || 'not configured';
}

function getImageryProviderName(viewer) {
  const imageryLayers = getViewerImageryLayersSafe(viewer);
  if (!imageryLayers?.length) return 'none';
  const layer = imageryLayers.get(imageryLayers.length - 1);
  return layer?.imageryProvider?.constructor?.name || 'unknown imagery provider';
}

function inferBasemapFromProvider(imageryProvider, currentBasemap) {
  if (/OpenStreetMap/i.test(imageryProvider)) return 'OSM';
  if (/GridImageryProvider|fallback grid/i.test(imageryProvider)) return 'Fallback basic scene';
  if (/Ion|Bing/i.test(imageryProvider)) return 'Cesium ion imagery';
  if (/UrlTemplate/i.test(imageryProvider)) return 'ArcGIS World Topographic Map';
  if (imageryProvider === 'none') return currentBasemap;
  return currentBasemap;
}

function hasRecoveredImageryProvider(imageryProvider) {
  return /OpenStreetMap|Ion|Bing|UrlTemplate/i.test(String(imageryProvider || ''));
}

function calculateSceneScale(viewer) {
  const scene = getViewerSceneSafe(viewer);
  const camera = getViewerCameraSafe(viewer);
  const canvas = scene?.canvas;
  if (!scene || !camera || !canvas) {
    return { label: 'scale pending', widthPx: 96, ratio: '' };
  }
  const samplePixels = 120;
  const y = Math.max(Math.min(canvas.clientHeight - 118, canvas.clientHeight * 0.72), 120);
  const x1 = Math.max(canvas.clientWidth / 2 - samplePixels / 2, 10);
  const x2 = Math.min(x1 + samplePixels, canvas.clientWidth - 10);
  const first = pickGlobePoint(scene, camera, x1, y);
  const second = pickGlobePoint(scene, camera, x2, y);
  let metersPerPixel = null;
  if (first && second) {
    const distance = surfaceDistanceMeters(first, second);
    if (Number.isFinite(distance) && distance > 0) {
      metersPerPixel = distance / Math.max(x2 - x1, 1);
    }
  }
  if (!metersPerPixel) {
    const cartographic = Cesium.Cartographic.fromCartesian(camera.positionWC);
    const frustumFovy = Number(camera.frustum?.fovy || Cesium.Math.toRadians(60));
    metersPerPixel = (2 * Math.tan(frustumFovy / 2) * Math.max(cartographic.height, 1)) / Math.max(canvas.clientHeight, 1);
  }
  const niceMeters = chooseNiceScaleDistance(metersPerPixel * samplePixels);
  const widthPx = Math.min(Math.max(niceMeters / metersPerPixel, 58), 180);
  return {
    label: formatScaleDistance(niceMeters),
    widthPx: Math.round(widthPx),
    ratio: `≈ 1:${Math.max(Math.round(metersPerPixel * 96 / 0.0254), 1).toLocaleString('en-US')}`,
  };
}

function pickGlobePoint(scene, camera, x, y) {
  try {
    const ray = camera.getPickRay(new Cesium.Cartesian2(x, y));
    return ray ? scene.globe.pick(ray, scene) : null;
  } catch {
    return null;
  }
}

function surfaceDistanceMeters(first, second) {
  const start = Cesium.Cartographic.fromCartesian(first);
  const end = Cesium.Cartographic.fromCartesian(second);
  const geodesic = new Cesium.EllipsoidGeodesic(start, end);
  return geodesic.surfaceDistance;
}

function chooseNiceScaleDistance(rawMeters) {
  const raw = Math.max(Number(rawMeters) || 1, 1);
  const exponent = Math.floor(Math.log10(raw));
  const base = 10 ** exponent;
  const fraction = raw / base;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * base;
}

function formatScaleDistance(meters) {
  if (meters >= 1000) {
    return `${Number(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: meters >= 10000 ? 0 : 1 })} km`;
  }
  return `${Math.round(meters).toLocaleString('en-US')} m`;
}

function updateCameraStatus(viewer, setMapStatus) {
  if (!viewer || !setMapStatus) return;
  const camera = getViewerCameraSafe(viewer);
  if (!camera) return;
  const cartographic = Cesium.Cartographic.fromCartesian(camera.positionWC);
  const height = Number.isFinite(cartographic.height) ? `${Math.round(cartographic.height)} m` : 'unknown';
  const pitch = `${Cesium.Math.toDegrees(camera.pitch).toFixed(1)} deg`;
  const heading = `${Cesium.Math.toDegrees(camera.heading).toFixed(1)} deg`;
  const scale = calculateSceneScale(viewer);
  const terrainProvider = getTerrainProviderName(viewer);
  const imageryProvider = getImageryProviderName(viewer);
  const hasTerrainDomLayer = typeof document !== 'undefined' && document.querySelector('.terrain-map-layer');
  setMapStatus((current) => {
    const usesDomTerrainImagery = current.mapMode === MAP_MODES.TERRAIN_IMAGERY && hasTerrainDomLayer;
    const displayImageryProvider = usesDomTerrainImagery ? 'DOM OpenStreetMap tiles' : imageryProvider;
    return {
      ...(hasRecoveredImageryProvider(displayImageryProvider) ? clearRecoveredMapLoadingStatus(current) : current),
      basemap: usesDomTerrainImagery ? '2D OpenStreetMap overlay' : inferBasemapFromProvider(displayImageryProvider, current.basemap),
      cesiumIon: CESIUM_ION_TOKEN && current.terrain === 'Cesium World Terrain' ? 'configured' : current.cesiumIon,
      terrainProvider,
      imageryProvider: displayImageryProvider,
      cameraHeight: height,
      cameraPitch: pitch,
      cameraHeading: heading,
      scaleLabel: scale.label,
      scaleWidthPx: scale.widthPx,
      scaleRatio: scale.ratio,
    };
  });
}

function buildMapDebugSnapshot(viewer, mapMode, mapStatus) {
  const camera = getViewerCameraSafe(viewer);
  const scene = getViewerSceneSafe(viewer);
  const cartographic = camera ? Cesium.Cartographic.fromCartesian(camera.positionWC) : null;
  let entityValues = [];
  try {
    entityValues = viewer.entities?.values || [];
  } catch {
    entityValues = [];
  }
  return {
    mapMode,
    basemap: mapStatus.basemap,
    terrain: mapStatus.terrain,
    google3dTiles: mapStatus.google3dTiles,
    tilesProvider: mapStatus.tilesProvider,
    imageryProvider: mapStatus.imageryProvider || getImageryProviderName(viewer),
    terrainProvider: getTerrainProviderName(viewer),
    imageryLayers: getViewerImageryLayersSafe(viewer)?.length || 0,
    entityCount: entityValues.length,
    pickableEntityCount: viewer.__taishanPickableEntities?.length || 0,
    communicationEntityCount: entityValues.filter((entity) => entity.metadata?.properties?.analysis_type === 'mountain_communication_visual').length,
    communicationStatus: viewer.__taishanCommunicationStatus || null,
    communicationProjectionSampleCount: viewer.__taishanCommunicationProjection?.currentProfile?.length || 0,
    communicationRouteProjectionCount: viewer.__taishanCommunicationProjection?.routeSamples?.length || 0,
    labelEntityCount: entityValues.filter((entity) => Boolean(entity.label)).length,
    towerLabelEntityCount: entityValues.filter((entity) => Boolean(entity.label) && Boolean(entity.metadata?.properties?.tower_id)).length,
    hasGoogleTileset: Boolean(viewer.__taishanTileset),
    globeShown: Boolean(scene?.globe?.show),
    depthTestAgainstTerrain: Boolean(scene?.globe?.depthTestAgainstTerrain),
    cameraHeightMeters: Number.isFinite(cartographic?.height) ? Math.round(cartographic.height) : null,
    cameraPitchDegrees: camera ? Number(Cesium.Math.toDegrees(camera.pitch).toFixed(1)) : null,
    cameraHeadingDegrees: camera ? Number(Cesium.Math.toDegrees(camera.heading).toFixed(1)) : null,
    tileCacheSize: scene?.globe?.tileCacheSize || null,
    tileWarmupMs: viewer.__taishanTileWarmupMs || null,
    tileStrategy: viewer.__taishanTileStrategy || mapStatus.tileStrategy || '',
    terrainVisual: viewer.__taishanTerrainVisual || mapStatus.terrainVisual || '',
    scaleLabel: mapStatus.scaleLabel || '',
    scaleRatio: mapStatus.scaleRatio || '',
    lastMapLoadingError: mapStatus.lastMapLoadingError || '',
    streetMapLayerCount: document.querySelectorAll('.street-map-layer').length,
    terrainMapLayerCount: document.querySelectorAll('.terrain-map-layer').length,
    clickablePoint: findDebugClickablePoint(viewer),
  };
}

function findDebugClickablePoint(viewer) {
  const entities = viewer.__taishanPickableEntities || [];
  const scene = getViewerSceneSafe(viewer);
  if (!scene) return null;
  const time = viewer.clock.currentTime;
  const width = window.innerWidth || 1600;
  const height = window.innerHeight || 900;
  for (const entity of entities) {
    if (!entity.metadata) continue;
    const props = entity.metadata.properties || {};
    if (!('tower_id' in props || 'route_id' in props || 'waypoint_id' in props || 'station_id' in props)) continue;
    const position = getEntityApproximateCartesian(entity, time);
    if (!position) continue;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, position);
    if (!screen) continue;
    if (screen.x < 360 || screen.x > width - 390 || screen.y < 115 || screen.y > height - 110) continue;
    return {
      x: Math.round(screen.x),
      y: Math.round(screen.y),
      title: entity.metadata.title || '',
    };
  }
  return null;
}

function flyToTerrainView(viewer, filtered, setMapStatus) {
  if (!viewer) return;
  const routeBounds = computeRouteBounds(filtered);
  const bounds = routeBounds || (filtered ? computeDataBounds(filtered) : null);
  const lon = bounds ? (bounds.west + bounds.east) / 2 : DEFAULT_TAIAN_VIEW.lon;
  const lat = bounds ? (bounds.south + bounds.north) / 2 : DEFAULT_TAIAN_VIEW.lat;
  const extentMeters = bounds ? Math.max(
    approximateMeters(bounds.east - bounds.west, lat),
    approximateMeters(bounds.north - bounds.south, 0),
  ) : 12000;
  const range = Math.min(Math.max(extentMeters * 0.58, 3600), 11000);
  focusCameraOnPoint(viewer, lon, lat, range, 1.05, 32, -36, () => updateCameraStatus(viewer, setMapStatus));
}

function flyTo3DSceneView(viewer, filtered, setMapStatus) {
  if (!viewer) return;
  const camera = getViewerCameraSafe(viewer);
  if (!camera) return;
  const routeBounds = computeRouteBounds(filtered);
  const bounds = routeBounds || (filtered ? computeDataBounds(filtered) : null);
  const lon = bounds ? (bounds.west + bounds.east) / 2 : DEFAULT_TAIAN_VIEW.lon;
  const lat = bounds ? (bounds.south + bounds.north) / 2 : DEFAULT_TAIAN_VIEW.lat;
  const extentMeters = bounds ? Math.max(
    approximateMeters(bounds.east - bounds.west, lat),
    approximateMeters(bounds.north - bounds.south, 0),
  ) : 9000;
  const height = Math.min(Math.max(extentMeters * 0.48, 4200), 12000);
  camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: Cesium.Math.toRadians(36),
      pitch: Cesium.Math.toRadians(-42),
      roll: 0,
    },
    duration: 0.9,
    complete: () => updateCameraStatus(viewer, setMapStatus),
  });
}

function filterData(data, filters, visibleRoutes) {
  const matchProps = (props) => {
    const line = String(props.line_name || props.tower_match?.line_name || '');
    const tower = String(props.tower_no || '');
    return (!filters.line || line.includes(filters.line)) && (!filters.tower || tower.includes(filters.tower));
  };
  const filterCollection = (collection, predicate) => (
    collection ? { ...collection, features: collection.features.filter(predicate) } : null
  );
  return {
    towers: filterCollection(data.towers, (feature) => matchProps(feature.properties || {})),
    lines: filterCollection(data.lines, (feature) => matchProps(feature.properties || {})),
    routes: filterCollection(data.routes, (feature) => visibleRoutes.has(feature.properties.route_id)),
    waypoints: filterCollection(data.waypoints, (feature) => visibleRoutes.has(feature.properties.route_id)),
    baseStations: data.baseStations,
  };
}

function buildTowerSelection(feature) {
  const props = feature?.properties || {};
  const rawHeight = Number(props.tower_height);
  const towerHeight = Number.isFinite(rawHeight) ? rawHeight : DEFAULT_TOWER_HEIGHT_M;
  const [longitude = props.longitude || '', latitude = props.latitude || ''] = feature?.geometry?.coordinates || [];
  return {
    title: '杆塔',
    properties: {
      ...props,
      longitude,
      latitude,
      tower_height_m: towerHeight,
      display_height_m: towerHeight + DISPLAY_HEIGHT_OFFSET_M,
      display_height_offset_m: DISPLAY_HEIGHT_OFFSET_M,
      height_source: Number.isFinite(rawHeight) ? 'ledger tower_height' : 'default height',
      data_boundary: 'display_height_offset_m is visualization only, not AGL or terrain elevation',
    },
  };
}

function buildRouteSelection(feature, metric, displaySource = 'Cesium 3D') {
  const props = feature?.properties || {};
  const coordinates = feature?.geometry?.coordinates || [];
  const hasKmlAltitude = coordinates.some((item) => item.length >= 3 && item[2] !== null && item[2] !== undefined);
  const towerMatch = metric?.tower_match || {};
  const nearestTower = towerMatch.line_name && towerMatch.tower_no
    ? `${towerMatch.line_name}${towerMatch.tower_no}`
    : '待匹配';
  return {
    title: 'KML 航线',
    properties: {
      ...props,
      ...metric,
      total_length_m: metric?.total_length ? Number(metric.total_length).toFixed(2) : '',
      average_waypoint_spacing_m: metric?.mean_segment_distance ? Number(metric.mean_segment_distance).toFixed(2) : '',
      height_range_m: metric?.min_height !== undefined && metric?.max_height !== undefined
        ? `${metric.min_height} - ${metric.max_height}`
        : '',
      nearest_tower: nearestTower,
      nearest_tower_distance_m: towerMatch.min_distance_to_tower ? Number(towerMatch.min_distance_to_tower).toFixed(2) : '',
      match_confidence: towerMatch.match_confidence || '',
      match_reason: towerMatch.match_reason || '',
      display_source: displaySource,
      display_height_offset_m: DISPLAY_HEIGHT_OFFSET_M,
      height_source: hasKmlAltitude ? 'KML altitude' : 'simulated/default height',
      data_boundary: 'KML altitude is used only when present; display offset is visualization only, not AGL',
    },
  };
}

function addTowerEntities(viewer, towers, refs) {
  towers.features.forEach((feature) => {
    const props = feature.properties || {};
    const [lon, lat] = feature.geometry.coordinates;
    const rawHeight = Number(props.tower_height);
    const height = Number.isFinite(rawHeight) ? rawHeight : DEFAULT_TOWER_HEIGHT_M;
    const heightNote = Number.isFinite(rawHeight) ? '真实台账高度' : 'default height';
    const top = Cesium.Cartesian3.fromDegrees(lon, lat, height + DISPLAY_HEIGHT_OFFSET_M);
    const base = Cesium.Cartesian3.fromDegrees(lon, lat, DISPLAY_HEIGHT_OFFSET_M);
    const columnMidpoint = Cesium.Cartesian3.fromDegrees(lon, lat, DISPLAY_HEIGHT_OFFSET_M + height / 2);
    const towerMetadata = buildTowerSelection(feature);

    refs.push(viewer.entities.add({
      position: columnMidpoint,
      cylinder: {
        length: Math.max(height, 20),
        topRadius: 3,
        bottomRadius: 9,
        material: Cesium.Color.CYAN.withAlpha(0.34),
        outline: true,
        outlineColor: Cesium.Color.CYAN.withAlpha(0.85),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      },
      metadata: towerMetadata,
    }));
    refs.push(viewer.entities.add({
      polyline: {
        positions: [base, top],
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25,
          color: Cesium.Color.CYAN.withAlpha(0.78),
        }),
      },
      metadata: towerMetadata,
    }));
    refs.push(viewer.entities.add({
      position: top,
      point: {
        pixelSize: 9,
        color: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      metadata: towerMetadata,
    }));
  });
}

function addStationEntities(viewer, baseStations, refs) {
  baseStations.features.forEach((feature) => {
    const props = feature.properties || {};
    const [lon, lat] = feature.geometry.coordinates;
    refs.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 50 + DISPLAY_HEIGHT_OFFSET_M),
      cylinder: {
        length: 100,
        topRadius: 0,
        bottomRadius: 18,
        material: Cesium.Color.ORANGERED.withAlpha(0.55),
        outline: true,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      },
      label: {
        text: props.station_id || '基站',
        font: '13px Microsoft YaHei',
        pixelOffset: new Cesium.Cartesian2(0, -18),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      metadata: { title: '基站/机场候选', properties: props },
    }));
  });
}

function addRouteEntities(viewer, routes, metrics, refs) {
  routes.features.forEach((feature, index) => {
    const props = feature.properties || {};
    const metric = metrics.find((item) => item.route_id === props.route_id);
    const color = routeColors[index % routeColors.length];
    const coordinates = feature.geometry.coordinates || [];
    const positions = coordinates.map(([lon, lat, alt]) => Cesium.Cartesian3.fromDegrees(lon, lat, routeDisplayHeight(alt)));
    const groundTracePositions = coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
    refs.push(viewer.entities.add({
      polyline: {
        positions: groundTracePositions,
        width: 3,
        clampToGround: true,
        material: color.withAlpha(0.62),
      },
      metadata: buildRouteSelection(feature, metric, 'Cesium 3D ground trace visualization'),
    }));
    refs.push(viewer.entities.add({
      polyline: {
        positions,
        width: 5,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.18, color }),
        depthFailMaterial: color.withAlpha(0.85),
      },
      metadata: buildRouteSelection(feature, metric, 'Cesium 3D'),
    }));
    addRouteEndpoint(viewer, refs, coordinates.at(0), color, '起点', props, metric);
    addRouteEndpoint(viewer, refs, coordinates.at(-1), Cesium.Color.LIME, '终点', props, metric);
    addRouteMidLabel(viewer, refs, coordinates, color, index, props, metric);
  });
}

function addRouteMidLabel(viewer, refs, coordinates, color, index, props, metric) {
  const midpoint = getCoordinateAtFraction(coordinates, 0.5);
  if (!midpoint) return;
  const label = props.kml_file ? shortFileLabel(props.kml_file) : `KML route ${index + 1}`;
  refs.push(viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(midpoint[0], midpoint[1], routeDisplayHeight(midpoint[2]) + 28),
    label: {
      text: label,
      font: '13px Microsoft YaHei',
      pixelOffset: new Cesium.Cartesian2(0, -18),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: color.withAlpha(0.35),
      scaleByDistance: new Cesium.NearFarScalar(1500, 1, 90000, 0.42),
      translucencyByDistance: new Cesium.NearFarScalar(1500, 1, 120000, 0.05),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    metadata: { title: `航线 ${label}`, properties: { ...props, ...metric } },
  }));
}

function addRouteEndpoint(viewer, refs, coordinate, color, label, props, metric) {
  if (!coordinate) return;
  refs.push(viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1], routeDisplayHeight(coordinate[2]) + 6),
      point: {
        pixelSize: label === '起点' ? 12 : 13,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    label: {
      text: label,
      font: '12px Microsoft YaHei',
      pixelOffset: new Cesium.Cartesian2(8, -14),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    metadata: { title: `航线${label}`, properties: { ...props, ...metric } },
  }));
}

function addWaypointEntities(viewer, waypoints, metrics, refs) {
  waypoints.features.forEach((feature) => {
    const props = feature.properties || {};
    const metric = metrics.find((item) => item.route_id === props.route_id);
    const [lon, lat, alt] = feature.geometry.coordinates;
    refs.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, routeDisplayHeight(alt) + 3),
      point: {
        pixelSize: 5,
        color: Cesium.Color.WHITE.withAlpha(0.88),
        outlineColor: Cesium.Color.DEEPSKYBLUE,
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      metadata: buildWaypointSelection(feature, metric),
    }));
  });
}

function addLineEntities(viewer, lines, refs) {
  lines.features.forEach((feature) => {
    const props = feature.properties || {};
    const coordinates = feature.geometry.coordinates || [];
    const positions = coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 4 + DISPLAY_HEIGHT_OFFSET_M));
    refs.push(viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.SEAGREEN.withAlpha(0.55),
      },
      metadata: { title: '线路候选', properties: props },
    }));
  });
}

function addLineLabelEntities(viewer, lines, refs) {
  lines.features.forEach((feature) => {
    const props = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    const labelCoordinate = getCoordinateAtFraction(coordinates, 0.5);
    if (!labelCoordinate || !props.line_name) return;
    refs.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(labelCoordinate[0], labelCoordinate[1], DISPLAY_HEIGHT_OFFSET_M + 90),
      label: {
        text: props.line_name,
        font: '12px Microsoft YaHei',
        pixelOffset: new Cesium.Cartesian2(0, -12),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.SEAGREEN.withAlpha(0.32),
        scaleByDistance: new Cesium.NearFarScalar(2500, 0.9, 85000, 0.32),
        translucencyByDistance: new Cesium.NearFarScalar(2500, 0.92, 110000, 0.05),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 95000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      metadata: { title: '线路标签', properties: props },
    }));
  });
}

function buildCommunicationPlan(baseStations, routePoints, selectedMetric, waypointIndex = 0) {
  if (!baseStations?.features?.length || !Array.isArray(routePoints) || !routePoints.length) return null;
  const source = pickCommunicationSource(baseStations, routePoints);
  if (!source) return null;
  const boundedIndex = Math.min(Math.max(Number(waypointIndex) || 0, 0), routePoints.length - 1);
  const currentPoint = routePoints[boundedIndex] || routePoints[0];
  const distances = routePoints.map((point) => distanceMeters(source, point));
  const requiredRadius = Math.max(...distances.filter((value) => Number.isFinite(value)), 0);
  return {
    source,
    routePoints,
    samplePoints: sampleRoutePoints(routePoints, COMMUNICATION_ROUTE_LINK_LIMIT),
    currentPoint,
    selectedMetric,
    waypointIndex: boundedIndex,
    requiredRadius,
    currentDistance: distanceMeters(source, currentPoint),
    frequencyGHz: COMMUNICATION_FREQUENCY_GHZ,
    baseAntennaHeightM: COMMUNICATION_BASE_ANTENNA_HEIGHT_M,
  };
}

function pickCommunicationSource(baseStations, routePoints) {
  const reference = routePoints[0];
  if (!reference) return null;
  let best = null;
  (baseStations.features || []).forEach((feature) => {
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) return;
    const candidate = {
      lon: Number(lon),
      lat: Number(lat),
      properties: feature.properties || {},
      stationId: feature.properties?.station_id || feature.properties?.name || feature.properties?.airport_name || 'auto base station',
      stationType: feature.properties?.station_type || feature.properties?.type || 'candidate',
    };
    const distance = distanceMeters(candidate, reference);
    if (!best || distance < best.distance) {
      best = { ...candidate, distance };
    }
  });
  return best;
}

function sampleRoutePoints(routePoints, limit) {
  if (!Array.isArray(routePoints) || routePoints.length <= limit) return routePoints || [];
  const step = (routePoints.length - 1) / Math.max(limit - 1, 1);
  const sampled = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(routePoints[Math.round(index * step)]);
  }
  const seen = new Set();
  return sampled.filter((point) => {
    if (!point) return false;
    const key = `${point.sequence ?? ''}:${point.lon}:${point.lat}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addCommunicationEntities(viewer, plan, refs) {
  const currentEvaluation = evaluateCommunicationLink(viewer, plan.source, plan.currentPoint, plan);
  const sampleEvaluations = plan.samplePoints.map((point) => ({
    point,
    evaluation: evaluateCommunicationLink(viewer, plan.source, point, plan),
  }));
  const metadata = buildCommunicationSelection(plan, currentEvaluation, 'current link');
  addCommunicationSourceEntity(viewer, plan, refs, metadata);
  addCommunicationCoverageDisc(viewer, plan, refs, metadata);
  addCommunicationSampleLinks(viewer, plan, sampleEvaluations, refs);
  addCommunicationRouteRiskRibbon(viewer, plan, sampleEvaluations, refs);
  addCommunicationCurrentLink(viewer, plan, currentEvaluation, refs, metadata);
  addCommunicationTerrainSampleBars(viewer, plan, currentEvaluation, refs, metadata);
  addCommunicationFresnelClearanceEnvelope(viewer, plan, currentEvaluation, refs, metadata);
  addCommunicationStatusMarker(viewer, plan, currentEvaluation, refs, metadata);
  const status = buildCommunicationStatus(plan, currentEvaluation, sampleEvaluations);
  const projection = buildCommunicationProjection(plan, currentEvaluation, sampleEvaluations, status);
  return { status, projection };
}

function addCommunicationSourceEntity(viewer, plan, refs, metadata) {
  const position = sourceCommunicationPosition(viewer, plan.source, plan.baseAntennaHeightM);
  refs.push(viewer.entities.add({
    position,
    point: {
      pixelSize: 14,
      color: Cesium.Color.ORANGERED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `通信源 ${plan.source.stationId}`,
      font: '12px Microsoft YaHei',
      pixelOffset: new Cesium.Cartesian2(0, -26),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: Cesium.Color.ORANGERED.withAlpha(0.34),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    metadata,
  }));
}

function addCommunicationCoverageDisc(viewer, plan, refs, metadata) {
  const radius = Math.max(plan.requiredRadius || 0, 250);
  refs.push(viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(plan.source.lon, plan.source.lat, 0),
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      material: Cesium.Color.CYAN.withAlpha(0.025),
      outline: true,
      outlineColor: Cesium.Color.CYAN.withAlpha(0.2),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    metadata: {
      ...metadata,
      properties: {
        ...metadata.properties,
        role: 'required-radius reference ring only; not Fresnel corridor',
        radius_m: Number(radius.toFixed(1)),
      },
    },
  }));
}

function addCommunicationSampleLinks(viewer, plan, sampleEvaluations, refs) {
  sampleEvaluations.forEach(({ point, evaluation }) => {
    if (!point || point === plan.currentPoint) return;
    const color = communicationColor(evaluation.status);
    refs.push(viewer.entities.add({
      polyline: {
        positions: [
          sourceCommunicationPosition(viewer, plan.source, plan.baseAntennaHeightM),
          targetCommunicationPosition(viewer, point),
        ],
        width: 1.4,
        material: color.withAlpha(0.2),
        depthFailMaterial: color.withAlpha(0.08),
      },
      metadata: buildCommunicationSelection(plan, evaluation, 'sample link'),
    }));
  });
}

function addCommunicationRouteRiskRibbon(viewer, plan, sampleEvaluations, refs) {
  if (sampleEvaluations.length < 2) return;
  for (let index = 1; index < sampleEvaluations.length; index += 1) {
    const previous = sampleEvaluations[index - 1];
    const current = sampleEvaluations[index];
    const color = communicationColor(worseCommunicationStatus(previous.evaluation.status, current.evaluation.status));
    refs.push(viewer.entities.add({
      polyline: {
        positions: [
          targetCommunicationPosition(viewer, previous.point),
          targetCommunicationPosition(viewer, current.point),
        ],
        width: 8,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.18,
          color: color.withAlpha(0.62),
        }),
        depthFailMaterial: color.withAlpha(0.34),
      },
      metadata: buildCommunicationSelection(plan, current.evaluation, 'route risk ribbon'),
    }));
  }
}

function addCommunicationCurrentLink(viewer, plan, evaluation, refs, metadata) {
  const color = communicationColor(evaluation.status);
  const sourcePosition = sourceCommunicationPosition(viewer, plan.source, plan.baseAntennaHeightM);
  const targetPosition = targetCommunicationPosition(viewer, plan.currentPoint);
  const tubeRadius = Math.min(Math.max(evaluation.maxFresnelRadiusM || 10, 8), 90);
  refs.push(viewer.entities.add({
    corridor: {
      positions: [
        Cesium.Cartesian3.fromDegrees(plan.source.lon, plan.source.lat, 0),
        Cesium.Cartesian3.fromDegrees(plan.currentPoint.lon, plan.currentPoint.lat, 0),
      ],
      width: Math.max(tubeRadius * 12, 180),
      material: color.withAlpha(0.2),
      outline: true,
      outlineColor: color.withAlpha(0.58),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    metadata: {
      ...metadata,
      properties: {
        ...metadata.properties,
        role: 'semi-transparent communication ground footprint',
      },
    },
  }));
  const curtain = buildCommunicationCurtain(viewer, plan, evaluation);
  refs.push(viewer.entities.add({
    wall: {
      positions: curtain.positions,
      minimumHeights: curtain.minimumHeights,
      maximumHeights: curtain.maximumHeights,
      material: color.withAlpha(0.26),
      outline: true,
      outlineColor: color.withAlpha(0.5),
    },
    metadata: {
      ...metadata,
      properties: {
        ...metadata.properties,
        role: 'semi-transparent line-of-sight profile curtain',
      },
    },
  }));
  refs.push(viewer.entities.add({
    polylineVolume: {
      positions: [sourcePosition, targetPosition],
      shape: communicationTubeShape(tubeRadius),
      material: color.withAlpha(0.12),
      outline: true,
      outlineColor: color.withAlpha(0.48),
      cornerType: Cesium.CornerType.ROUNDED,
    },
    metadata: {
      ...metadata,
      properties: {
        ...metadata.properties,
        role: 'first Fresnel envelope visual; terrain profile is shown by sample bars',
        fresnel_radius_m: Number(tubeRadius.toFixed(1)),
      },
    },
  }));
  refs.push(viewer.entities.add({
    polyline: {
      positions: [sourcePosition, targetPosition],
      width: 5.5,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.36,
        color: color.withAlpha(0.92),
      }),
      depthFailMaterial: color.withAlpha(0.42),
    },
    metadata,
  }));
  const midpoint = interpolateLonLat(plan.source, plan.currentPoint, 0.5);
  refs.push(viewer.entities.add({
    position: targetCommunicationPosition(viewer, { ...midpoint, height: (routeHeight(plan.currentPoint.height) + plan.baseAntennaHeightM) / 2 }),
    label: {
      text: `${evaluation.label}\n${formatDistance(plan.currentDistance)}`,
      font: '12px Microsoft YaHei',
      pixelOffset: new Cesium.Cartesian2(0, -14),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: color.withAlpha(0.35),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    metadata,
  }));
}

function addCommunicationTerrainSampleBars(viewer, plan, evaluation, refs, metadata) {
  const samples = Array.isArray(evaluation.samples) ? evaluation.samples : [];
  samples.forEach((sample) => {
    if (!Number.isFinite(sample.terrainHeight) || !Number.isFinite(sample.linkHeight)) return;
    const color = communicationColor(sample.status);
    const sampleMetadata = buildCommunicationSampleSelection(plan, evaluation, sample, 'terrain clearance sample');
    refs.push(viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.terrainHeight + 2),
          Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.linkHeight),
        ],
        width: sample.status === 'los' ? 1.8 : 3.4,
        material: color.withAlpha(sample.status === 'los' ? 0.52 : 0.84),
        depthFailMaterial: color.withAlpha(0.32),
      },
      metadata: sampleMetadata,
    }));
    refs.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.terrainHeight + 3),
      point: {
        pixelSize: sample.status === 'los' ? 5 : 9,
        color: color.withAlpha(0.86),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      metadata: sampleMetadata,
    }));
  });
}

function addCommunicationFresnelClearanceEnvelope(viewer, plan, evaluation, refs, metadata) {
  const positions = (evaluation.samples || [])
    .filter((sample) => Number.isFinite(sample.linkHeight) && Number.isFinite(sample.fresnelRadius))
    .map((sample) => {
      const clearanceBoundary = sample.linkHeight - Math.max(COMMUNICATION_TERRAIN_MARGIN_M, sample.fresnelRadius * 0.6);
      return Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, clearanceBoundary);
    });
  if (positions.length < 2) return;
  const color = communicationColor(evaluation.status);
  refs.push(viewer.entities.add({
    polyline: {
      positions,
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({
        color: color.withAlpha(0.76),
        dashLength: 14,
      }),
      depthFailMaterial: color.withAlpha(0.34),
    },
    metadata: {
      ...metadata,
      properties: {
        ...metadata.properties,
        role: '60 percent Fresnel clearance boundary',
        terrain_relation: 'terrain samples crossing this boundary are marked as Fresnel risk',
      },
    },
  }));
}

function buildCommunicationCurtain(viewer, plan, evaluation) {
  const positions = [];
  const minimumHeights = [];
  const maximumHeights = [];
  const sourceTerrain = readCachedTerrainHeight(viewer, plan.source.lon, plan.source.lat);
  const targetTerrain = readCachedTerrainHeight(viewer, plan.currentPoint.lon, plan.currentPoint.lat);
  const sourceAbs = Number.isFinite(sourceTerrain)
    ? sourceTerrain + plan.baseAntennaHeightM
    : DISPLAY_HEIGHT_OFFSET_M + COMMUNICATION_PENDING_VISUAL_LIFT_M + plan.baseAntennaHeightM;
  const targetAbs = Number.isFinite(targetTerrain)
    ? targetTerrain + routeHeight(plan.currentPoint.height)
    : routeDisplayHeight(plan.currentPoint.height) + COMMUNICATION_PENDING_VISUAL_LIFT_M;
  const profileSamples = Array.isArray(evaluation?.samples) && evaluation.samples.length >= 2
    ? evaluation.samples
    : Array.from({ length: 10 }, (_, index) => ({
      fraction: index / 9,
      ...interpolateLonLat(plan.source, plan.currentPoint, index / 9),
    }));
  profileSamples.forEach((sample) => {
    const coordinate = sample;
    const terrainHeight = Number.isFinite(sample.terrainHeight)
      ? sample.terrainHeight
      : readCachedTerrainHeight(viewer, coordinate.lon, coordinate.lat);
    const lineHeight = Number.isFinite(sample.linkHeight)
      ? sample.linkHeight
      : sourceAbs + (targetAbs - sourceAbs) * sample.fraction;
    const groundHeight = Number.isFinite(terrainHeight)
      ? terrainHeight
      : Math.max(Math.min(sourceAbs, targetAbs) - 90, 0);
    positions.push(Cesium.Cartesian3.fromDegrees(coordinate.lon, coordinate.lat, 0));
    minimumHeights.push(groundHeight);
    maximumHeights.push(Math.max(lineHeight, groundHeight + 18));
  });
  return { positions, minimumHeights, maximumHeights };
}

function addCommunicationStatusMarker(viewer, plan, evaluation, refs, metadata) {
  if (!evaluation.worstPoint || !['nlos', 'fresnel_risk'].includes(evaluation.status)) return;
  const color = communicationColor(evaluation.status);
  refs.push(viewer.entities.add({
    position: targetCommunicationPosition(viewer, {
      lon: evaluation.worstPoint.lon,
      lat: evaluation.worstPoint.lat,
      height: 18,
    }),
    point: {
      pixelSize: 12,
      color,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: evaluation.status === 'nlos' ? '山体遮挡风险' : '菲涅尔区风险',
      font: '12px Microsoft YaHei',
      pixelOffset: new Cesium.Cartesian2(0, -22),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: color.withAlpha(0.38),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    metadata: {
      ...metadata,
      properties: {
        ...metadata.properties,
        role: 'visual obstruction marker',
        worst_clearance_m: Number(evaluation.worstClearanceM?.toFixed?.(1) ?? 0),
      },
    },
  }));
}

function evaluateCommunicationLink(viewer, source, targetPoint, plan) {
  const totalMeters = distanceMeters(source, targetPoint);
  const totalKm = totalMeters / 1000;
  const sourceTerrain = readCachedTerrainHeight(viewer, source.lon, source.lat);
  const targetTerrain = readCachedTerrainHeight(viewer, targetPoint.lon, targetPoint.lat);
  const sourceAbs = Number.isFinite(sourceTerrain) ? sourceTerrain + plan.baseAntennaHeightM : null;
  const targetAbs = Number.isFinite(targetTerrain) ? targetTerrain + routeHeight(targetPoint.height) : null;
  let availableSamples = 0;
  let status = 'los';
  let worstClearanceM = Number.POSITIVE_INFINITY;
  let worstPoint = null;
  let maxFresnelRadiusM = 0;
  const samples = [];

  for (let index = 0; index < COMMUNICATION_SAMPLE_COUNT; index += 1) {
    const fraction = COMMUNICATION_SAMPLE_COUNT === 1 ? 0 : index / (COMMUNICATION_SAMPLE_COUNT - 1);
    const coordinate = interpolateLonLat(source, targetPoint, fraction);
    const d1Km = Math.max(totalKm * fraction, 0.001);
    const d2Km = Math.max(totalKm * (1 - fraction), 0.001);
    const fresnelRadius = firstFresnelRadiusMeters(d1Km, d2Km, Math.max(totalKm, 0.001), plan.frequencyGHz);
    maxFresnelRadiusM = Math.max(maxFresnelRadiusM, fresnelRadius);
    const terrainHeight = readCachedTerrainHeight(viewer, coordinate.lon, coordinate.lat);
    const hasTerrain = Number.isFinite(terrainHeight) && Number.isFinite(sourceAbs) && Number.isFinite(targetAbs);
    const linkHeight = hasTerrain ? sourceAbs + (targetAbs - sourceAbs) * fraction : null;
    let sampleStatus = 'visual_only';
    let clearance = null;
    if (hasTerrain) {
      availableSamples += 1;
      clearance = linkHeight - terrainHeight;
      if (clearance < worstClearanceM) {
        worstClearanceM = clearance;
        worstPoint = {
          ...coordinate,
          fraction,
          terrainHeight,
          linkHeight,
          fresnelRadius,
          clearance,
        };
      }
      if (terrainHeight >= linkHeight) {
        sampleStatus = 'nlos';
      } else if (terrainHeight + Math.max(COMMUNICATION_TERRAIN_MARGIN_M, fresnelRadius * 0.6) >= linkHeight) {
        sampleStatus = 'fresnel_risk';
      } else {
        sampleStatus = 'los';
      }
      status = worseCommunicationStatus(status, sampleStatus);
    }
    samples.push({
      index,
      fraction,
      lon: coordinate.lon,
      lat: coordinate.lat,
      terrainHeight,
      linkHeight,
      clearance,
      fresnelRadius,
      status: sampleStatus,
    });
  }

  if (availableSamples < Math.ceil(COMMUNICATION_SAMPLE_COUNT * 0.55)) {
    status = 'visual_only';
  }

  return {
    status,
    label: communicationStatusLabel(status),
    totalMeters,
    availableSamples,
    sampleCount: COMMUNICATION_SAMPLE_COUNT,
    worstClearanceM: Number.isFinite(worstClearanceM) ? worstClearanceM : null,
    worstPoint,
    maxFresnelRadiusM: maxFresnelRadiusM || firstFresnelRadiusMeters(totalKm / 2, totalKm / 2, Math.max(totalKm, 0.001), plan.frequencyGHz),
    samples,
  };
}

function buildCommunicationStatus(plan, currentEvaluation, sampleEvaluations) {
  const counts = sampleEvaluations.reduce((acc, item) => {
    acc[item.evaluation.status] = (acc[item.evaluation.status] || 0) + 1;
    return acc;
  }, {});
  return {
    enabled: true,
    status: currentEvaluation.status,
    label: currentEvaluation.label,
    source: plan.source.stationId,
    route: plan.selectedMetric?.kml_file || '',
    waypoint: `${plan.waypointIndex + 1}/${plan.routePoints.length}`,
    linkDistance: formatDistance(plan.currentDistance),
    requiredRadius: formatDistance(plan.requiredRadius),
    frequency: `${plan.frequencyGHz} GHz`,
    baseAntennaHeight: `${plan.baseAntennaHeightM} m AGL assumed`,
    worstClearance: Number.isFinite(currentEvaluation.worstClearanceM)
      ? `${currentEvaluation.worstClearanceM.toFixed(1)} m`
      : 'terrain pending',
    sampleCoverage: `${currentEvaluation.availableSamples}/${currentEvaluation.sampleCount}`,
    routeRiskSummary: `LOS ${counts.los || 0} / Fresnel ${counts.fresnel_risk || 0} / NLOS ${counts.nlos || 0} / pending ${counts.visual_only || 0}`,
    model: currentEvaluation.status === 'visual_only'
      ? '2D projection + semi-transparent corridor; terrain sampling pending'
      : 'terrain profile samples + 60% Fresnel clearance heuristic + 2D projection',
    terrainSource: 'Cesium World Terrain display cache, not project DEM/DSM',
    boundary: 'visual prototype only; not real communication coverage, AGL, or safety conclusion',
  };
}

function buildCommunicationSelection(plan, evaluation, role) {
  return {
    title: '通信遮挡演示',
    properties: {
      analysis_type: 'mountain_communication_visual',
      role,
      status: evaluation.label,
      source_station: plan.source.stationId,
      source_type: plan.source.stationType,
      route_id: plan.selectedMetric?.route_id || plan.currentPoint.routeId || '',
      kml_file: plan.selectedMetric?.kml_file || '',
      waypoint_id: plan.currentPoint.waypointId || '',
      sequence: plan.currentPoint.sequence || '',
      waypoint: `${plan.waypointIndex + 1}/${plan.routePoints.length}`,
      link_distance_m: Number(plan.currentDistance.toFixed(1)),
      required_route_radius_m: Number(plan.requiredRadius.toFixed(1)),
      frequency_ghz: plan.frequencyGHz,
      base_antenna_height_m: plan.baseAntennaHeightM,
      terrain_samples: `${evaluation.availableSamples}/${evaluation.sampleCount}`,
      worst_clearance_m: Number.isFinite(evaluation.worstClearanceM) ? Number(evaluation.worstClearanceM.toFixed(1)) : 'terrain pending',
      terrain_link_method: 'Cesium cached terrain heights + first Fresnel zone heuristic',
      projection_layer: '3D terrain profile and 2D map projection share the same sampled link geometry',
      model: evaluation.status === 'visual_only'
        ? '2D projection + semi-transparent corridor; terrain sampling pending'
        : 'terrain profile samples + 60% Fresnel clearance heuristic + 2D projection',
      data_boundary: 'visual prototype only; no real DEM/DSM, measured link budget, or coverage conclusion',
    },
  };
}

function buildCommunicationSampleSelection(plan, evaluation, sample, role) {
  const selection = buildCommunicationSelection(plan, evaluation, role);
  return {
    ...selection,
    properties: {
      ...selection.properties,
      sample_index: sample.index,
      sample_fraction: Number(sample.fraction.toFixed(3)),
      sample_status: communicationStatusLabel(sample.status),
      terrain_height_m: Number.isFinite(sample.terrainHeight) ? Number(sample.terrainHeight.toFixed(1)) : 'terrain pending',
      link_height_m: Number.isFinite(sample.linkHeight) ? Number(sample.linkHeight.toFixed(1)) : 'terrain pending',
      clearance_m: Number.isFinite(sample.clearance) ? Number(sample.clearance.toFixed(1)) : 'terrain pending',
      fresnel_radius_m: Number.isFinite(sample.fresnelRadius) ? Number(sample.fresnelRadius.toFixed(1)) : '',
    },
  };
}

function buildCommunicationProjection(plan, currentEvaluation, sampleEvaluations, status) {
  const routeSamples = sampleEvaluations.map(({ point, evaluation }, index) => ({
    index,
    point: {
      lon: point.lon,
      lat: point.lat,
      sequence: point.sequence,
      waypointId: point.waypointId,
    },
    status: evaluation.status,
    label: evaluation.label,
    linkDistanceM: evaluation.totalMeters,
    fresnelRadiusM: evaluation.maxFresnelRadiusM,
    terrainSampleCoverage: `${evaluation.availableSamples}/${evaluation.sampleCount}`,
    worstPoint: evaluation.worstPoint ? simplifyTerrainPoint(evaluation.worstPoint) : null,
  }));
  return {
    route_id: plan.selectedMetric?.route_id || plan.currentPoint.routeId || '',
    kml_file: plan.selectedMetric?.kml_file || '',
    status: currentEvaluation.status,
    label: currentEvaluation.label,
    source: {
      lon: plan.source.lon,
      lat: plan.source.lat,
      stationId: plan.source.stationId,
      stationType: plan.source.stationType,
    },
    currentPoint: {
      lon: plan.currentPoint.lon,
      lat: plan.currentPoint.lat,
      sequence: plan.currentPoint.sequence,
      waypointId: plan.currentPoint.waypointId,
    },
    waypoint: `${plan.waypointIndex + 1}/${plan.routePoints.length}`,
    requiredRadiusM: plan.requiredRadius,
    currentDistanceM: currentEvaluation.totalMeters,
    currentFresnelRadiusM: currentEvaluation.maxFresnelRadiusM,
    terrainSampleCoverage: `${currentEvaluation.availableSamples}/${currentEvaluation.sampleCount}`,
    worstClearanceM: currentEvaluation.worstClearanceM,
    worstPoint: currentEvaluation.worstPoint ? simplifyTerrainPoint(currentEvaluation.worstPoint) : null,
    currentProfile: (currentEvaluation.samples || []).map(simplifyTerrainPoint),
    routeSamples,
    statusSummary: status?.routeRiskSummary || '',
  };
}

function simplifyTerrainPoint(point) {
  return {
    lon: point.lon,
    lat: point.lat,
    index: point.index,
    fraction: point.fraction,
    terrainHeight: point.terrainHeight,
    linkHeight: point.linkHeight,
    clearance: point.clearance,
    fresnelRadius: point.fresnelRadius,
    status: point.status,
  };
}

function communicationTubeShape(radiusMeters) {
  const radius = Math.max(Number(radiusMeters) || 8, 2);
  const steps = 20;
  return Array.from({ length: steps }, (_, index) => {
    const angle = (Math.PI * 2 * index) / steps;
    return new Cesium.Cartesian2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

function sourceCommunicationPosition(viewer, source, antennaHeightM) {
  const terrainHeight = readCachedTerrainHeight(viewer, source.lon, source.lat);
  const height = Number.isFinite(terrainHeight)
    ? terrainHeight + antennaHeightM
    : DISPLAY_HEIGHT_OFFSET_M + COMMUNICATION_PENDING_VISUAL_LIFT_M + antennaHeightM;
  return Cesium.Cartesian3.fromDegrees(source.lon, source.lat, height);
}

function targetCommunicationPosition(viewer, point) {
  const terrainHeight = readCachedTerrainHeight(viewer, point.lon, point.lat);
  const height = Number.isFinite(terrainHeight)
    ? terrainHeight + routeHeight(point.height)
    : routeDisplayHeight(point.height) + COMMUNICATION_PENDING_VISUAL_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(point.lon, point.lat, height);
}

function readCachedTerrainHeight(viewer, lon, lat) {
  const globe = getViewerSceneSafe(viewer)?.globe;
  if (!globe || !Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) return null;
  try {
    const height = globe.getHeight(Cesium.Cartographic.fromDegrees(Number(lon), Number(lat)));
    return Number.isFinite(height) ? height : null;
  } catch {
    return null;
  }
}

function firstFresnelRadiusMeters(d1Km, d2Km, totalKm, frequencyGHz) {
  const denominator = Math.max(Number(frequencyGHz) * Number(totalKm), 0.001);
  return 17.32 * Math.sqrt((Math.max(d1Km, 0.001) * Math.max(d2Km, 0.001)) / denominator);
}

function communicationColor(status) {
  if (status === 'nlos') return Cesium.Color.RED;
  if (status === 'fresnel_risk') return Cesium.Color.YELLOW;
  if (status === 'los') return Cesium.Color.fromCssColorString('#20e6ff');
  return Cesium.Color.fromCssColorString('#54d2ff');
}

function communicationStatusLabel(status) {
  if (status === 'nlos') return 'NLOS 山体遮挡风险';
  if (status === 'fresnel_risk') return 'Fresnel 菲涅尔区风险';
  if (status === 'los') return 'LOS 视距可通';
  if (status === 'disabled') return '通信图层关闭';
  return 'terrain pending 视觉走廊';
}

function worseCommunicationStatus(left, right) {
  const order = { nlos: 4, fresnel_risk: 3, visual_only: 2, los: 1 };
  return (order[left] || 0) >= (order[right] || 0) ? left : right;
}

function interpolateLonLat(source, target, fraction) {
  const t = Math.min(Math.max(Number(fraction) || 0, 0), 1);
  return {
    lon: Number(source.lon) + (Number(target.lon) - Number(source.lon)) * t,
    lat: Number(source.lat) + (Number(target.lat) - Number(source.lat)) * t,
  };
}

function distanceMeters(left, right) {
  const leftLon = Number(left?.lon);
  const leftLat = Number(left?.lat);
  const rightLon = Number(right?.lon);
  const rightLat = Number(right?.lat);
  if (![leftLon, leftLat, rightLon, rightLat].every(Number.isFinite)) return Number.NaN;
  const radians = Math.PI / 180;
  const dLat = (rightLat - leftLat) * radians;
  const dLon = (rightLon - leftLon) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(leftLat * radians) * Math.cos(rightLat * radians) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(1 - a, 0)));
}

function formatDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) return 'pending';
  if (distance >= 1000) return `${(distance / 1000).toFixed(2)} km`;
  return `${distance.toFixed(0)} m`;
}

function addFallbackSceneFrame(viewer, filtered, refs) {
  const bounds = expandBounds(computeDataBounds(filtered), 0.035) || {
    west: DEFAULT_TAIAN_VIEW.lon - 0.35,
    east: DEFAULT_TAIAN_VIEW.lon + 0.35,
    south: DEFAULT_TAIAN_VIEW.lat - 0.25,
    north: DEFAULT_TAIAN_VIEW.lat + 0.25,
  };
  const frameHeight = 1200;
  refs.push(viewer.entities.add({
    rectangle: {
      coordinates: Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
      material: Cesium.Color.fromCssColorString('#315b69').withAlpha(0.62),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#d7fbff').withAlpha(0.95),
      height: frameHeight,
    },
    metadata: {
      title: 'Fallback 基础场景',
      properties: {
        basemap: 'Fallback basic scene',
        note: '无 token 或在线底图失败时显示的基础网格，不代表真实地形/影像',
      },
    },
  }));
  const step = Math.max((bounds.east - bounds.west) / 8, 0.03);
  for (let lon = bounds.west; lon <= bounds.east + 1e-9; lon += step) {
    refs.push(viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(lon, bounds.south, frameHeight + 20),
          Cesium.Cartesian3.fromDegrees(lon, bounds.north, frameHeight + 20),
        ],
        width: 2,
        material: Cesium.Color.fromCssColorString('#d7fbff').withAlpha(0.8),
        depthFailMaterial: Cesium.Color.fromCssColorString('#d7fbff').withAlpha(0.8),
      },
    }));
  }
  const latStep = Math.max((bounds.north - bounds.south) / 8, 0.03);
  for (let lat = bounds.south; lat <= bounds.north + 1e-9; lat += latStep) {
    refs.push(viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(bounds.west, lat, frameHeight + 20),
          Cesium.Cartesian3.fromDegrees(bounds.east, lat, frameHeight + 20),
        ],
        width: 2,
        material: Cesium.Color.fromCssColorString('#d7fbff').withAlpha(0.8),
        depthFailMaterial: Cesium.Color.fromCssColorString('#d7fbff').withAlpha(0.8),
      },
    }));
  }
  refs.push(viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(
      (bounds.west + bounds.east) / 2,
      (bounds.south + bounds.north) / 2,
      frameHeight + 250,
    ),
    label: {
      text: 'Taian inspection data extent',
      font: '16px Segoe UI',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  }));
  refs.push(viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(
      (bounds.west + bounds.east) / 2,
      (bounds.south + bounds.north) / 2,
      frameHeight + 500,
    ),
    point: {
      pixelSize: 28,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  }));
}

function getRoutePoints(waypoints, routeId) {
  if (!waypoints || !routeId) return [];
  return waypoints.features
    .filter((feature) => feature.properties.route_id === routeId)
    .sort((a, b) => Number(a.properties.sequence) - Number(b.properties.sequence))
    .map((feature) => ({
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      height: routeHeight(feature.geometry.coordinates[2]),
      routeId: feature.properties.route_id,
      waypointId: feature.properties.waypoint_id,
      sequence: feature.properties.sequence,
    }));
}

function getSelectedWaypointIndex(selected, selectedRouteId, routePoints) {
  if (!selectedRouteId || !routePoints.length) return 0;
  const props = selected?.properties || {};
  const representativeIndex = Math.floor((routePoints.length - 1) / 2);
  if (props.route_id !== selectedRouteId) return representativeIndex;
  const waypointId = String(props.waypoint_id || '');
  if (waypointId) {
    const index = routePoints.findIndex((point) => String(point.waypointId || '') === waypointId);
    if (index >= 0) return index;
  }
  const sequence = Number(props.sequence);
  if (Number.isFinite(sequence)) {
    const index = routePoints.findIndex((point) => Number(point.sequence) === sequence);
    if (index >= 0) return index;
  }
  return representativeIndex;
}

function routeHeight(value) {
  return Number.isFinite(Number(value)) ? Number(value) : DEFAULT_ROUTE_HEIGHT_M;
}

function routeDisplayHeight(value) {
  return routeHeight(value) + DISPLAY_HEIGHT_OFFSET_M;
}

function flyToData(viewer, filtered) {
  if (viewer.__hasFlown) return;
  const bounds = computeDataBounds(filtered);
  const lon = bounds ? (bounds.west + bounds.east) / 2 : DEFAULT_TAIAN_VIEW.lon;
  const lat = bounds ? (bounds.south + bounds.north) / 2 : DEFAULT_TAIAN_VIEW.lat;
  const extentMeters = bounds ? Math.max(
    approximateMeters(bounds.east - bounds.west, lat),
    approximateMeters(bounds.north - bounds.south, 0),
  ) : DEFAULT_TAIAN_VIEW.height / 2;
  const height = Math.min(Math.max(extentMeters * 0.32, 6500), 18000);
  focusCameraOnPoint(viewer, lon, lat, height, 1.15, 22, -50);
  viewer.__hasFlown = true;
}

function focusCameraOnPoint(viewer, lon, lat, range, duration, headingDegrees = 28, pitchDegrees = -40, complete) {
  const camera = getViewerCameraSafe(viewer);
  if (!camera) return;
  const target = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  const sphere = new Cesium.BoundingSphere(target, Math.max(range * 0.08, 800));
  const offset = new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(headingDegrees),
    Cesium.Math.toRadians(pitchDegrees),
    range,
  );
  if (duration > 0) {
    camera.flyToBoundingSphere(sphere, { offset, duration, complete });
    return;
  }
  camera.lookAt(target, offset);
  camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  complete?.();
}

function computeDataBounds(filtered) {
  if (!filtered) return null;
  const coordinates = [];
  collectFeatureCoordinates(filtered.towers, coordinates);
  collectFeatureCoordinates(filtered.routes, coordinates);
  collectFeatureCoordinates(filtered.baseStations, coordinates);
  if (!coordinates.length) return null;
  return {
    west: Math.min(...coordinates.map((item) => item[0])),
    east: Math.max(...coordinates.map((item) => item[0])),
    south: Math.min(...coordinates.map((item) => item[1])),
    north: Math.max(...coordinates.map((item) => item[1])),
  };
}

function computeRouteBounds(filtered) {
  const coordinates = [];
  collectFeatureCoordinates(filtered?.routes, coordinates);
  collectFeatureCoordinates(filtered?.waypoints, coordinates);
  if (!coordinates.length) return null;
  return {
    west: Math.min(...coordinates.map((item) => item[0])),
    east: Math.max(...coordinates.map((item) => item[0])),
    south: Math.min(...coordinates.map((item) => item[1])),
    north: Math.max(...coordinates.map((item) => item[1])),
  };
}

function expandBounds(bounds, paddingDegrees) {
  if (!bounds) return null;
  return {
    west: bounds.west - paddingDegrees,
    east: bounds.east + paddingDegrees,
    south: bounds.south - paddingDegrees,
    north: bounds.north + paddingDegrees,
  };
}

function collectFeatureCoordinates(collection, output) {
  if (!collection?.features) return;
  collection.features.forEach((feature) => {
    const geometry = feature.geometry || {};
    if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
      output.push(geometry.coordinates);
    }
    if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((coordinate) => output.push(coordinate));
    }
  });
}

function getCoordinateAtFraction(coordinates, fraction = 0.5) {
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  if (coordinates.length === 1) return coordinates[0];
  const segmentLengths = [];
  let totalLength = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    const midLat = ((Number(previous?.[1]) || 0) + (Number(current?.[1]) || 0)) / 2;
    const dx = approximateMeters((Number(current?.[0]) || 0) - (Number(previous?.[0]) || 0), midLat);
    const dy = approximateMeters((Number(current?.[1]) || 0) - (Number(previous?.[1]) || 0), 0);
    const length = Math.hypot(dx, dy);
    segmentLengths.push(length);
    totalLength += length;
  }
  if (!totalLength) return coordinates[Math.floor(coordinates.length / 2)];
  const target = totalLength * Math.min(Math.max(fraction, 0), 1);
  let walked = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const length = segmentLengths[index - 1];
    if (walked + length >= target) {
      const t = length ? (target - walked) / length : 0;
      const previous = coordinates[index - 1];
      const current = coordinates[index];
      return [
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
        Number(previous[2] || 0) + (Number(current[2] || 0) - Number(previous[2] || 0)) * t,
      ];
    }
    walked += length;
  }
  return coordinates.at(-1);
}

function shortFileLabel(fileName) {
  const text = String(fileName || '');
  const baseName = text.split(/[\\/]/).pop() || text;
  return baseName.replace(/\.(kml|kmz)$/i, '').slice(0, 28);
}

function approximateMeters(deltaDegrees, latitude) {
  const latScale = Math.max(Math.cos(Cesium.Math.toRadians(latitude)), 0.25);
  return Math.abs(deltaDegrees) * 111000 * (latitude === 0 ? 1 : latScale);
}

function clearEntities(viewer, refs) {
  refs.forEach((entity) => viewer.entities.remove(entity));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function toggleRoute(routeId, visibleRoutes, setVisibleRoutes) {
  const next = new Set(visibleRoutes);
  if (next.has(routeId)) {
    next.delete(routeId);
  } else {
    next.add(routeId);
  }
  setVisibleRoutes(next);
}

function findRouteIdByImportedFile(routes, storedFilename) {
  if (!routes?.features || !storedFilename) return '';
  const match = routes.features.find((feature) => feature.properties?.kml_file === storedFilename);
  return match?.properties?.route_id || '';
}

function Metric({ label, value }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScaleBar({ status }) {
  const width = Math.min(Math.max(Number(status?.scaleWidthPx) || 96, 56), 190);
  return (
    <div className="scale-bar" aria-label="当前地图比例尺">
      <div className="scale-bar-line" style={{ width: `${width}px` }} />
      <div className="scale-bar-meta">
        <strong>{status?.scaleLabel || 'scale pending'}</strong>
        <span>{status?.scaleRatio || '≈'}</span>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled = false }) {
  return (
    <label className={`toggle-line ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function SelectionSummaryPanel({ selected, selectedMetric }) {
  const title = selected?.title || (selectedMetric ? 'KML 航线' : '对象');
  const properties = selected?.properties || defaultSelection(selectedMetric);
  const entries = buildOrderedPropertyEntries(title, properties).slice(0, 6);
  return (
    <section className="selection-summary">
      <h3>选中摘要</h3>
      <div className="selection-summary-title">
        <strong>{title}</strong>
        <span>{selected?.properties ? 'selected object' : 'route default'}</span>
      </div>
      <div className="selection-summary-grid">
        {entries.map(([key, value]) => (
          <div key={key}>
            <span>{key}</span>
            <strong>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function PropertyTable({ properties, title }) {
  const orderedEntries = buildOrderedPropertyEntries(title, properties);
  return (
    <dl className="property-table">
      {orderedEntries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}</dd>
        </div>
      ))}
    </dl>
  );
}

function buildOrderedPropertyEntries(title, properties) {
  const entries = Object.entries(properties || {});
  const priorityKeys = getSelectionPriorityKeys(title, properties);
  const priorityOrder = new Map(priorityKeys.map((key, index) => [key, index]));
  return entries
    .slice()
    .sort((left, right) => {
      const leftPriority = priorityOrder.has(left[0]) ? priorityOrder.get(left[0]) : Number.POSITIVE_INFINITY;
      const rightPriority = priorityOrder.has(right[0]) ? priorityOrder.get(right[0]) : Number.POSITIVE_INFINITY;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return String(left[0]).localeCompare(String(right[0]), 'zh-Hans-CN');
    });
}

function getSelectionPriorityKeys(title, properties = {}) {
  const props = properties || {};
  const normalized = String(title || '');
  if (props.analysis_type === 'mountain_communication_visual') {
    return ['analysis_type', 'role', 'status', 'source_station', 'source_type', 'kml_file', 'waypoint', 'link_distance_m', 'required_route_radius_m', 'frequency_ghz', 'base_antenna_height_m', 'terrain_samples', 'sample_status', 'terrain_height_m', 'link_height_m', 'clearance_m', 'fresnel_radius_m', 'worst_clearance_m', 'terrain_link_method', 'projection_layer', 'model', 'data_boundary'];
  }
  if ('waypoint_id' in props || 'sequence' in props && 'kml_altitude_m' in props) {
    return ['waypoint_id', 'route_id', 'kml_file', 'sequence', 'longitude', 'latitude', 'kml_altitude_m', 'display_height_m', 'display_height_offset_m', 'height_source', 'nearest_tower', 'route_total_length_m', 'speed', 'heading', 'gimbal_pitch', 'turn_mode', 'source_file'];
  }
  if ('tower_height' in props || 'tower_no' in props || 'tower_id' in props) {
    return ['line_name', 'tower_no', 'tower_id', 'longitude', 'latitude', 'tower_height', 'display_height_m', 'display_height_offset_m', 'height_source', 'airport_distance_m', 'source_file', 'source_row'];
  }
  if ('station_id' in props) {
    return ['station_id', 'longitude', 'latitude', 'station_type', 'source_file', 'source_row'];
  }
  if ('manifest_file' in props && 'schema_version' in props) {
    return ['manifest_file', 'manifest_api', 'schema_version', 'generated_at', 'source_root', 'input_files', 'kml_files', 'processed_files', 'task_rows', 'route_rows', 'waypoint_rows', 'tower_csv_rows', 'route_geojson_features', 'waypoint_geojson_features', 'first_input_file', 'first_input_sha256'];
  }
  if ('issue_type' in props && 'severity' in props) {
    return ['issue_type', 'severity', 'entity_id', 'line_name', 'tower_no', 'location_status', 'map_visibility', 'source_file', 'source_row', 'message', 'recommended_action', 'report_source', 'issue_source'];
  }
  if ('template_file' in props && 'pending_rows' in props) {
    return ['template_file', 'pending_rows', 'source_file', 'source_row', 'entity_id', 'line_name', 'tower_no', 'current_longitude', 'current_latitude', 'longitude_to_fill', 'latitude_to_fill', 'review_status', 'validation_report', 'validation_api', 'remediation_rule'];
  }
  if ('kml_file' in props && ('route_id' in props || 'waypoint_count' in props || 'total_length_m' in props || 'route_total_length_m' in props)) {
    return ['kml_file', 'route_id', 'waypoint_count', 'total_length_m', 'route_total_length_m', 'height_range_m', 'min_height', 'max_height', 'average_waypoint_spacing_m', 'nearest_tower', 'nearest_tower_distance_m', 'route_type_guess', 'height_source', 'display_source', 'source_file'];
  }
  if (normalized === '杆塔') {
    return ['line_name', 'tower_no', 'tower_id', 'longitude', 'latitude', 'tower_height', 'display_height_m', 'display_height_offset_m', 'height_source', 'airport_distance_m', 'source_file', 'source_row'];
  }
  return [];
}

function CommunicationStatusPanel({ status }) {
  if (!status) return null;
  return (
    <section className={`communication-status ${status.status || 'pending'}`}>
      <h3><RadioTower size={14} />山体通信影响</h3>
      <div className="communication-status-main">
        <strong>{status.label || '待分析'}</strong>
        <span>{status.enabled === false ? '图层已关闭' : (status.route ? '半透明视距 / 菲涅尔走廊' : '选择航线后启用')}</span>
      </div>
      <div className="communication-status-grid">
        <div><span>通信源</span><strong>{status.source || 'auto'}</strong></div>
        <div><span>航点</span><strong>{status.waypoint || 'pending'}</strong></div>
        <div><span>链路距离</span><strong>{status.linkDistance || 'pending'}</strong></div>
        <div><span>所需半径</span><strong>{status.requiredRadius || 'pending'}</strong></div>
        <div><span>频段</span><strong>{status.frequency || `${COMMUNICATION_FREQUENCY_GHZ} GHz`}</strong></div>
        <div><span>地形采样</span><strong>{status.sampleCoverage || 'pending'}</strong></div>
        <div><span>最小净空</span><strong>{status.worstClearance || 'terrain pending'}</strong></div>
        <div><span>航线摘要</span><strong>{status.routeRiskSummary || 'pending'}</strong></div>
      </div>
      <p>{status.model}</p>
      <p>{status.boundary}</p>
    </section>
  );
}

function MapStatusPanel({ status }) {
  return (
    <section className="map-status">
      <div><span>当前地图模式</span><strong>{status.mapMode}</strong></div>
      <div><span>底图来源</span><strong>{status.basemap}</strong></div>
      <div><span>terrain provider</span><strong>{status.terrainProvider}</strong></div>
      <div><span>imagery provider</span><strong>{status.imageryProvider}</strong></div>
      <div><span>地形来源</span><strong>{status.terrain}</strong></div>
      <div><span>3D tiles provider</span><strong>{status.tilesProvider}</strong></div>
      <div><span>terrain exaggeration</span><strong>{status.terrainExaggeration}</strong></div>
      <div><span>terrain visual</span><strong>{status.terrainVisual || 'pending'}</strong></div>
      <div className="wide"><span>communication overlay</span><strong>{status.communicationOverlay || 'semi-transparent visual prototype'}</strong></div>
      <div><span>camera height</span><strong>{status.cameraHeight || 'pending'}</strong></div>
      <div><span>camera pitch</span><strong>{status.cameraPitch || 'pending'}</strong></div>
      <div><span>camera heading</span><strong>{status.cameraHeading || 'pending'}</strong></div>
      <div><span>tile cache</span><strong>{status.tileCache || `${CESIUM_TILE_CACHE_SIZE} tiles`}</strong></div>
      <div><span>tile warmup</span><strong>{status.tileWarmup || `${CESIUM_TILE_WARMUP_MS} ms`}</strong></div>
      <div><span>map scale</span><strong>{status.scaleLabel || 'pending'}</strong></div>
      <div className="wide"><span>tile strategy</span><strong>{status.tileStrategy || 'visible first'}</strong></div>
      <div><span>Google 3D Tiles</span><strong>{status.google3dTiles}</strong></div>
      <div><span>Cesium ion</span><strong>{status.cesiumIon}</strong></div>
      <div><span>Viewer</span><strong>{status.viewer}</strong></div>
      <div className="wide"><span>展示高度偏移</span><strong>{status.displayOffset}</strong></div>
      <div className="wide"><span>last map loading error</span><strong>{status.lastMapLoadingError || '无'}</strong></div>
      <div className="wide"><span>最近地形错误</span><strong>{status.lastTerrainError || '无'}</strong></div>
      <div className="wide"><span>最近错误</span><strong>{status.lastError || '无'}</strong></div>
    </section>
  );
}

function QualitySummaryPanel({ quality }) {
  if (!quality || quality.status === 'not_generated') {
    return (
      <section className="quality-summary">
        <h3>数据质量</h3>
        <div className="wide"><span>状态</span><strong>未生成</strong></div>
      </section>
    );
  }
  const towerCoordinates = quality.coordinate_ranges?.towers || {};
  const issueCounts = quality.issue_counts || {};
  const idChecks = quality.id_checks || {};
  const routeMatches = quality.route_match_summary || {};
  const validTowers = Number(towerCoordinates.valid_coordinate_count || 0);
  const missingTowers = Number(towerCoordinates.missing_coordinate_count || 0);
  const totalTowerCoordinateRows = validTowers + missingTowers;
  const duplicateIds = Object.values(idChecks).reduce(
    (sum, item) => sum + Number(item?.duplicate_id_count || 0),
    0,
  );
  const routeMatchHigh = Number(routeMatches.confidence_counts?.high || 0);
  const routeMatchTotal = Number(routeMatches.rows || 0);
  const swappedRisk = Number(towerCoordinates.possible_lon_lat_swapped_count || 0);
  const totalIssues = Number(issueCounts.total || 0);

  return (
    <section className="quality-summary">
      <h3>数据质量</h3>
      <div><span>有效杆塔坐标</span><strong>{validTowers}/{totalTowerCoordinateRows}</strong></div>
      <div className={missingTowers ? 'warning' : ''}><span>缺失坐标</span><strong>{missingTowers}</strong></div>
      <div className={swappedRisk ? 'warning' : ''}><span>经纬度反置风险</span><strong>{swappedRisk}</strong></div>
      <div><span>航线匹配 high</span><strong>{routeMatchHigh}/{routeMatchTotal}</strong></div>
      <div className={duplicateIds ? 'warning' : ''}><span>标准 ID 重复</span><strong>{duplicateIds}</strong></div>
      <div className={totalIssues ? 'warning' : ''}><span>质量问题</span><strong>{totalIssues}</strong></div>
    </section>
  );
}

function QualityIssuesPanel({ issues, onSelectIssue }) {
  const safeIssues = Array.isArray(issues) ? issues : [];
  if (!safeIssues.length) {
    return (
      <section className="quality-issues">
        <h3>数据质量问题明细</h3>
        <p className="quality-issues-empty">当前没有已登记的问题明细。</p>
      </section>
    );
  }
  const visibleIssues = safeIssues.slice(0, 8);
  return (
    <section className="quality-issues">
      <h3>数据质量问题明细</h3>
      <p className="quality-issues-meta">共 {safeIssues.length} 条，点击可查看处理建议。</p>
      <div className="quality-issue-list">
        {visibleIssues.map((issue, index) => {
          const parsed = parseQualityIssueEntity(issue.entity_id, issue);
          return (
            <button
              type="button"
              className={`quality-issue-button ${issue.severity || 'unknown'}`}
              key={`${issue.table || 'table'}-${issue.entity_id || index}-${issue.issue_type || 'issue'}`}
              onClick={() => onSelectIssue(issue)}
            >
              <span className="quality-issue-code">{issue.issue_type || 'unknown_issue'}</span>
              <strong>{formatQualityIssueTarget(parsed, issue.entity_id)}</strong>
              <small>{formatQualityIssueSource(issue)}{issue.message ? ` / ${issue.message}` : ''}</small>
            </button>
          );
        })}
      </div>
      {safeIssues.length > visibleIssues.length && (
        <p className="quality-issues-more">另有 {safeIssues.length - visibleIssues.length} 条，完整清单见 data/processed/data_quality_issues.csv。</p>
      )}
    </section>
  );
}

function CoordinateBackfillPanel({ rows, validation, onSelect }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const pendingRows = Number(validation?.pending_rows ?? safeRows.length);
  const validRows = Number(validation?.valid_rows ?? 0);
  const issueRows = Number(validation?.incomplete_rows ?? 0)
    + Number(validation?.invalid_numeric_rows ?? 0)
    + Number(validation?.possible_lon_lat_swapped_rows ?? 0)
    + Number(validation?.out_of_taian_range_rows ?? 0);
  if (!safeRows.length) {
    return (
      <section className="coordinate-backfill">
        <h3>坐标补录模板</h3>
        <p className="coordinate-backfill-empty">当前没有待补录坐标。</p>
      </section>
    );
  }
  const first = safeRows[0];
  return (
    <section className="coordinate-backfill">
      <h3>坐标补录模板</h3>
      <button type="button" className="coordinate-backfill-button" onClick={() => onSelect(first)}>
        <span>待补坐标 {safeRows.length} 条</span>
        <strong>{first.line_name || 'unknown line'} {first.tower_no || ''}</strong>
        <small>{first.source_file || 'source unknown'}{first.source_row ? ` row ${first.source_row}` : ''}</small>
      </button>
      <div className="coordinate-backfill-status">
        <span>pending {pendingRows}</span>
        <span>valid {validRows}</span>
        <span>issues {issueRows}</span>
      </div>
      <p>模板文件：data/processed/coordinate_backfill_template.csv</p>
    </section>
  );
}

function ManifestSummaryPanel({ manifest, onSelect }) {
  if (!manifest || manifest.status === 'not_generated') {
    return (
      <section className="manifest-summary">
        <h3>数据来源</h3>
        <div className="wide"><span>状态</span><strong>未生成</strong></div>
      </section>
    );
  }
  const inputFiles = Array.isArray(manifest.input_files) ? manifest.input_files : [];
  const processedFiles = Array.isArray(manifest.processed_files) ? manifest.processed_files : [];
  const kmlFiles = inputFiles.filter((item) => item.role === 'kml_file');
  const towerRows = Number(manifest.row_counts?.towers || 0);
  const routeRows = Number(manifest.row_counts?.routes || 0);
  const waypointRows = Number(manifest.row_counts?.route_waypoints || 0);
  const taskRows = Number(manifest.row_counts?.flight_tasks || 0);

  return (
    <section className="manifest-summary">
      <h3>数据来源</h3>
      <button type="button" className="manifest-summary-button" onClick={() => onSelect(manifest)}>
        <span>manifest.json</span>
        <strong>{inputFiles.length} 个原始文件 · {processedFiles.length} 个处理产物</strong>
        <small>{manifest.source_root || 'unknown source root'} · schema {manifest.schema_version || 'unknown'}</small>
      </button>
      <div className="manifest-counts">
        <span>Excel {inputFiles.length - kmlFiles.length}</span>
        <span>KML {kmlFiles.length}</span>
        <span>杆塔 {towerRows}</span>
        <span>航点 {waypointRows}</span>
      </div>
      <p>任务 {taskRows} 条，航线 {routeRows} 条；清单只用于追溯和验收。</p>
    </section>
  );
}

function buildManifestSelection(manifest) {
  const inputFiles = Array.isArray(manifest?.input_files) ? manifest.input_files : [];
  const processedFiles = Array.isArray(manifest?.processed_files) ? manifest.processed_files : [];
  const kmlFiles = inputFiles.filter((item) => item.role === 'kml_file');
  const towersGeojson = findManifestProcessedFile(manifest, 'towers_geojson');
  const routesGeojson = findManifestProcessedFile(manifest, 'routes_geojson');
  const waypointsGeojson = findManifestProcessedFile(manifest, 'route_waypoints_geojson');
  return {
    title: '数据处理清单',
    properties: {
      manifest_file: 'data/processed/manifest.json',
      manifest_api: '/api/manifest',
      schema_version: manifest?.schema_version || 'unknown',
      generated_at: manifest?.generated_at || 'unknown',
      source_root: manifest?.source_root || 'unknown',
      input_files: inputFiles.length,
      kml_files: kmlFiles.length,
      processed_files: processedFiles.length,
      tower_csv_rows: manifest?.row_counts?.towers ?? '',
      tower_geojson_features: towersGeojson?.features ?? '',
      route_rows: manifest?.row_counts?.routes ?? '',
      route_geojson_features: routesGeojson?.features ?? '',
      waypoint_rows: manifest?.row_counts?.route_waypoints ?? '',
      waypoint_geojson_features: waypointsGeojson?.features ?? '',
      task_rows: manifest?.row_counts?.flight_tasks ?? '',
      first_input_file: inputFiles[0]?.path || '',
      first_input_sha256: inputFiles[0]?.sha256 || '',
      data_boundary: 'manifest 只记录文件、hash、行数和质量统计；不代表 DEM/DSM 高程、通信覆盖或飞行安全结论。',
    },
  };
}

function findManifestProcessedFile(manifest, role) {
  return (manifest?.processed_files || []).find((item) => item.role === role);
}

function buildWaypointSelection(feature, metric) {
  const props = feature?.properties || {};
  const coordinates = feature?.geometry?.coordinates || [];
  const altitude = routeHeight(coordinates[2]);
  return {
    title: '航点',
    properties: {
      waypoint_id: props.waypoint_id || 'unknown',
      route_id: props.route_id || 'unknown',
      kml_file: metric?.kml_file || props.source_file || '',
      sequence: props.sequence ?? '',
      longitude: coordinates[0] ?? props.longitude ?? '',
      latitude: coordinates[1] ?? props.latitude ?? '',
      kml_altitude_m: coordinates[2] ?? props.altitude ?? '',
      display_height_m: altitude + DISPLAY_HEIGHT_OFFSET_M,
      display_height_offset_m: DISPLAY_HEIGHT_OFFSET_M,
      height_source: coordinates[2] === null || coordinates[2] === undefined ? 'simulated/default height' : 'KML altitude',
      speed: props.speed ?? '',
      heading: props.heading ?? '',
      gimbal_pitch: props.gimbal_pitch ?? '',
      turn_mode: props.turn_mode ?? '',
      route_total_length_m: metric?.total_length ? Number(metric.total_length).toFixed(2) : '',
      nearest_tower: metric?.tower_match ? `${metric.tower_match.line_name}${metric.tower_match.tower_no}` : '待匹配',
      source_file: props.source_file || metric?.source_file || '',
    },
  };
}

function isSelectedFeature(selected, title, props, key) {
  if (!selected?.properties || !props || !key) return false;
  const titleMatches = selected.title === title || (title === 'KML 航线' && String(selected.title || '').startsWith('航线'));
  if (!titleMatches) return false;
  const current = props[key];
  const chosen = selected.properties[key];
  return current !== undefined && chosen !== undefined && String(current) === String(chosen);
}

function parseQualityIssueEntity(entityId, issue = {}) {
  const text = String(entityId || '');
  const [lineName, towerNo] = text.split('__');
  return {
    lineName: issue.line_name || lineName || '',
    towerNo: issue.tower_no || towerNo || '',
  };
}

function formatQualityIssueTarget(parsed, entityId) {
  if (parsed.lineName && parsed.towerNo) return `${parsed.lineName} #${parsed.towerNo}`;
  return String(entityId || 'unknown entity');
}

function formatQualityIssueSource(issue) {
  const sourceFile = issue?.source_file || 'source unknown';
  const sourceRow = issue?.source_row ? ` row ${issue.source_row}` : '';
  return `${sourceFile}${sourceRow}`;
}

function buildCoordinateBackfillSelection(row, totalRows) {
  return {
    title: '坐标补录模板',
    properties: {
      template_file: 'data/processed/coordinate_backfill_template.csv',
      pending_rows: totalRows,
      source_file: row?.source_file || 'unknown',
      source_row: row?.source_row || 'unknown',
      entity_id: row?.entity_id || 'unknown',
      line_name: row?.line_name || 'unknown',
      tower_no: row?.tower_no || 'unknown',
      current_longitude: row?.current_longitude || '',
      current_latitude: row?.current_latitude || '',
      longitude_to_fill: row?.longitude_to_fill || '',
      latitude_to_fill: row?.latitude_to_fill || '',
      review_status: row?.review_status || 'pending',
      validation_report: 'output/coordinate_backfill_validation_report.json',
      validation_api: '/api/data-quality/coordinate-backfill-validation-report',
      remediation_rule: '回到 source_file/source_row 补齐原始台账经纬度，再重新运行 scripts/run_data_pipeline.ps1',
      data_boundary: '模板不生成、不推断、不伪造坐标；空白经纬度需要人工补录。',
    },
  };
}

function buildQualityIssueSelection(issue) {
  const parsed = parseQualityIssueEntity(issue?.entity_id, issue || {});
  const isMissingCoordinate = issue?.issue_type === 'missing_coordinate';
  return {
    title: '数据质量问题',
    properties: {
      table: issue?.table || 'unknown',
      entity_id: issue?.entity_id || 'unknown',
      line_name: parsed.lineName || 'unknown',
      tower_no: parsed.towerNo || 'unknown',
      source_file: issue?.source_file || 'unknown',
      source_row: issue?.source_row || 'unknown',
      raw_longitude: issue?.longitude || '',
      raw_latitude: issue?.latitude || '',
      severity: issue?.severity || 'unknown',
      issue_type: issue?.issue_type || 'unknown',
      message: issue?.message || 'unknown',
      location_status: isMissingCoordinate
        ? 'not_mappable_missing_coordinate / 无法地图定位：原始台账缺少经纬度或字段无法转为数字'
        : 'needs_review / 待复核',
      map_visibility: isMissingCoordinate
        ? 'not_rendered_on_map / 不在地图上渲染，避免伪造坐标'
        : 'review_required / 需要按问题类型复核',
      recommended_action: isMissingCoordinate
        ? '补充杆塔台账经纬度，重新运行 scripts/run_data_pipeline.ps1'
        : '查看 data/processed/data_quality_issues.csv 并按字段含义修正源数据',
      report_source: 'output/data_quality_report.json',
      issue_source: 'data/processed/data_quality_issues.csv',
    },
  };
}

function formatMapStatus(status) {
  return `模式：${status.mapMode}；底图：${status.basemap}；地形：${status.terrain}；影像：${status.imageryProvider}；3D Tiles：${status.tilesProvider}；Ion：${status.cesiumIon}${status.lastMapLoadingError ? `；地图错误：${status.lastMapLoadingError}` : ''}`;
}

function defaultSelection(metric) {
  return metric ? {
    kml_file: metric.kml_file,
    waypoint_count: metric.waypoint_count,
    total_length_m: Number(metric.total_length || 0).toFixed(2),
    height_range_m: `${metric.min_height} - ${metric.max_height}`,
    nearest_tower: metric.tower_match ? `${metric.tower_match.line_name}${metric.tower_match.tower_no}` : '待匹配',
    time_data: '当前 KML 未提供真实时间戳；页面不提供飞行动画回放',
  } : { status: '点击杆塔、航线、航点或基站查看属性' };
}

function formatMeters(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} m` : 'default height';
}

export default App;
