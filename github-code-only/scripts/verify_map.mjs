import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const frontendRequire = createRequire(path.join(rootDir, 'frontend', 'package.json'));
const { chromium } = frontendRequire('playwright');
const outputDir = path.join(rootDir, 'output');
const screenshotPath = path.join(outputDir, 'verified-map.png');
const failureScreenshotPath = path.join(outputDir, 'verify-map-failure.png');
const reportPath = path.join(outputDir, 'map_verification_report.json');
const url = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function addCheck(report, name, passed, expected, actual) {
  report.checks.push({ name, passed: Boolean(passed), expected, actual });
  assert(passed, `${name}: ${expected}\nActual: ${JSON.stringify(actual)}`);
}

async function writeMapReport(report) {
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

async function getDebug(page) {
  return page.evaluate(() => window.__taishanMapDebug?.());
}

async function waitForMapMode(page, mode) {
  await page.waitForFunction(
    (expectedMode) => window.__taishanMapDebug?.().mapMode === expectedMode,
    mode,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(2_000);
  return getDebug(page);
}

async function clickSegmentedButton(page, sectionIndex, buttonIndex) {
  await page.locator('.segmented-control').nth(sectionIndex).locator('button').nth(buttonIndex).click();
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    status: 'failed',
    url,
    viewport: { width: 1600, height: 900 },
    screenshot: screenshotPath,
    failure_screenshot: failureScreenshotPath,
    report: reportPath,
    checks: [],
    terrain_snapshot: null,
    basic_grid_snapshot: null,
    three_d_snapshot: null,
    post_move_snapshot: null,
    error: '',
  };

  let browser;
  let page;
  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: report.viewport });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.cesium-stage canvas', { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.__taishanMapDebug), null, { timeout: 30_000 });

    const terrainSnapshot = await waitForMapMode(page, 'terrain_imagery');
    const terrainStatusText = await page.locator('.map-status').innerText();
    const scaleText = await page.locator('.scale-bar').innerText();
    const initialCommunicationPanelText = await page.locator('.communication-status').innerText();
    const initialCommunicationToggleDisabled = await page.locator('.communication-control input[type="checkbox"]').isDisabled();
    report.terrain_snapshot = terrainSnapshot;

    const terrainDomOverlayCount = await page.locator('.terrain-map-layer').count();
    const terrainDataOverlayCount = await page.locator('.data-overlay').count();
    addCheck(report, 'terrain imagery keeps 2D map overlay', terrainSnapshot.terrainMapLayerCount === 1 && terrainDomOverlayCount === 1, 'terrain imagery should render exactly one 2D DOM OSM layer', { terrainSnapshot, terrainDomOverlayCount });
    addCheck(report, 'terrain imagery has no extra fallback overlay', terrainDataOverlayCount === 0, 'terrain imagery should not render the basic-grid data overlay', { terrainDataOverlayCount, terrainSnapshot });
    addCheck(report, 'terrain imagery uses 2D surface status', /2D/.test(String(terrainSnapshot.terrain)) && /DOM OpenStreetMap/.test(String(terrainSnapshot.imageryProvider)), 'terrain imagery should report 2D OSM instead of Cesium 3D terrain', terrainSnapshot);
    addCheck(report, 'terrain imagery does not show contour material', /2D map overlay/i.test(String(terrainSnapshot.terrainVisual || '')), 'terrain imagery should not claim 3D contour visual material', terrainSnapshot);
    addCheck(report, 'scale bar is visible', /m|km/.test(scaleText) && terrainSnapshot.scaleLabel, 'scale bar should show a current distance label', { scaleText, scaleLabel: terrainSnapshot.scaleLabel, scaleRatio: terrainSnapshot.scaleRatio });
    addCheck(report, 'terrain mode status does not show map unavailable', !/map data not yet available/i.test(terrainStatusText), 'terrain status should not surface unavailable ArcGIS placeholder tiles', terrainStatusText.slice(0, 1000));
    addCheck(
      report,
      'Fresnel corridor waits for route selection',
      terrainSnapshot.communicationEntityCount === 0
        && initialCommunicationToggleDisabled
        && /选择一条航线|选择 KML 航线/.test(initialCommunicationPanelText),
      'communication/Fresnel overlay should not appear before a route is selected',
      { terrainSnapshot, initialCommunicationToggleDisabled, initialCommunicationPanelText: initialCommunicationPanelText.slice(0, 700) },
    );

    await page.getByRole('button', { name: '地形观察视角' }).click();
    await page.locator('.segmented-control.compact button').nth(3).click();
    await page.waitForTimeout(1_500);
    const exaggeratedSnapshot = await getDebug(page);
    const exaggeratedStatus = await page.locator('.map-status').innerText();
    report.exaggerated_snapshot = exaggeratedSnapshot;
    addCheck(report, 'terrain view button keeps low-angle camera', exaggeratedSnapshot.cameraPitchDegrees > -50 && exaggeratedSnapshot.cameraPitchDegrees < -20, 'terrain view should use a low tilted camera angle', exaggeratedSnapshot);
    addCheck(report, 'terrain exaggeration button updates status', exaggeratedStatus.includes('3x'), 'clicking 3x should update terrain exaggeration status', exaggeratedStatus.slice(0, 800));

    await clickSegmentedButton(page, 0, 1);
    const basicGridSnapshot = await waitForMapMode(page, 'basic_grid');
    const dataOverlayCount = await page.locator('.data-overlay').count();
    report.basic_grid_snapshot = basicGridSnapshot;
    addCheck(report, 'basic grid is distinct from terrain imagery', dataOverlayCount === 0 && basicGridSnapshot.terrainMapLayerCount === 0 && String(basicGridSnapshot.basemap).includes('Fallback'), 'basic grid should show only the Cesium fallback grid, without terrain DOM or data overlays', { dataOverlayCount, basicGridSnapshot });
    addCheck(report, 'basic grid disables contour visual material', /basic grid only/i.test(String(basicGridSnapshot.terrainVisual || '')), 'basic grid should not claim real terrain/contours', basicGridSnapshot);

    await clickSegmentedButton(page, 0, 2);
    const threeDSnapshot = await waitForMapMode(page, 'photorealistic_3d_tiles');
    const threeDStatusText = await page.locator('.map-status').innerText();
    report.three_d_snapshot = threeDSnapshot;
    addCheck(report, '3D mode switches without 2D overlays', threeDSnapshot.mapMode === 'photorealistic_3d_tiles' && threeDSnapshot.terrainMapLayerCount === 0 && threeDSnapshot.streetMapLayerCount === 0, '3D mode should not keep terrain/street DOM overlays mounted', threeDSnapshot);
    addCheck(report, '3D mode keeps Cesium scene alive', threeDSnapshot.globeShown && /TerrainProvider|not configured/i.test(String(threeDSnapshot.terrainProvider || '')), '3D mode should retain a Cesium scene even when external 3D Tiles are not configured', threeDSnapshot);
    addCheck(report, '3D labels are reduced', threeDSnapshot.labelEntityCount < 180 && threeDSnapshot.towerLabelEntityCount === 0, '3D scene should not label every tower point', threeDSnapshot);
    addCheck(report, '3D mode keeps business entities', threeDSnapshot.entityCount >= 1000 && threeDSnapshot.pickableEntityCount >= 1000, '3D scene should contain tower/route/waypoint entities', threeDSnapshot);
    addCheck(report, '3D mode status is coherent', !/map data not yet available|undefined|null/i.test(threeDStatusText), '3D status should not expose unavailable-tile or undefined placeholders', threeDStatusText.slice(0, 1000));
    addCheck(report, '3D mode has no Fresnel corridor before route selection', threeDSnapshot.communicationEntityCount === 0, '3D communication corridor should wait until the operator selects a route', threeDSnapshot);

    await page.locator('.route-switch').first().click();
    await page.waitForFunction(() => (window.__taishanMapDebug?.().communicationEntityCount || 0) >= 6, null, { timeout: 20_000 });
    await page.waitForTimeout(800);
    const selectedRouteCommunicationSnapshot = await getDebug(page);
    const communicationPanelText = await page.locator('.communication-status').innerText();
    addCheck(report, 'selected route creates semi-transparent Fresnel entities', selectedRouteCommunicationSnapshot.communicationEntityCount >= 6, 'selecting a route should create pickable Fresnel corridor/link/radius entities', selectedRouteCommunicationSnapshot);
    addCheck(report, 'communication panel explains visual boundary', /通信源|链路距离|视觉原型|coverage|terrain pending|LOS|Fresnel|NLOS/.test(communicationPanelText), 'communication status panel should expose source, link state, and visual-prototype boundary', communicationPanelText.slice(0, 900));

    const routeSwitchCount = await page.locator('.route-switch').count();
    const routeCommunicationSnapshots = [];
    for (let index = 0; index < routeSwitchCount; index += 1) {
      const routeButton = page.locator('.route-switch').nth(index);
      const routeLabel = (await routeButton.locator('strong').innerText()).trim();
      await routeButton.click();
      await page.waitForFunction(
        (expectedRoute) => {
          const debug = window.__taishanMapDebug?.();
          return (debug?.communicationEntityCount || 0) >= 6
            && String(debug?.communicationStatus?.route || '').trim() === expectedRoute;
        },
        routeLabel,
        { timeout: 20_000 },
      );
      await page.waitForTimeout(600);
      const routeSnapshot = await getDebug(page);
      const routeCommunication = {
        index,
        route: routeLabel,
        status: routeSnapshot.communicationStatus?.status || '',
        label: routeSnapshot.communicationStatus?.label || '',
        waypoint: routeSnapshot.communicationStatus?.waypoint || '',
        source: routeSnapshot.communicationStatus?.source || '',
        communicationEntityCount: routeSnapshot.communicationEntityCount,
      };
      routeCommunicationSnapshots.push(routeCommunication);
      addCheck(
        report,
        `route ${index + 1} creates Fresnel corridor`,
        routeSnapshot.communicationEntityCount >= 6,
        'every KML route should create semi-transparent Fresnel/link entities when selected',
        routeCommunication,
      );
    }
    report.route_communication_snapshots = routeCommunicationSnapshots;

    const checkboxCommunicationSnapshots = [];
    for (let index = 0; index < routeSwitchCount; index += 1) {
      const routeButton = page.locator('.route-switch').nth(index);
      const routeLabel = (await routeButton.locator('strong').innerText()).trim();
      await routeButton.locator('input[type="checkbox"]').click();
      await page.waitForFunction(
        (expectedRoute) => {
          const debug = window.__taishanMapDebug?.();
          return (debug?.communicationEntityCount || 0) >= 6
            && String(debug?.communicationStatus?.route || '').trim() === expectedRoute;
        },
        routeLabel,
        { timeout: 20_000 },
      );
      await page.waitForTimeout(500);
      const checkboxSnapshot = await getDebug(page);
      checkboxCommunicationSnapshots.push({
        index,
        route: routeLabel,
        waypoint: checkboxSnapshot.communicationStatus?.waypoint || '',
        source: checkboxSnapshot.communicationStatus?.source || '',
        communicationEntityCount: checkboxSnapshot.communicationEntityCount,
      });
      addCheck(
        report,
        `route ${index + 1} checkbox selects Fresnel corridor`,
        String(checkboxSnapshot.communicationStatus?.route || '').trim() === routeLabel
          && checkboxSnapshot.communicationEntityCount >= 6,
        'clicking the route visibility checkbox should also switch the current communication/Fresnel route',
        checkboxSnapshot,
      );
      if (!(await routeButton.locator('input[type="checkbox"]').isChecked())) {
        await routeButton.locator('input[type="checkbox"]').click();
        await page.waitForTimeout(300);
      }
    }
    report.checkbox_communication_snapshots = checkboxCommunicationSnapshots;

    await clickSegmentedButton(page, 0, 0);
    const terrainProjectionSnapshot = await waitForMapMode(page, 'terrain_imagery');
    await page.waitForSelector('.street-communication-projection', { timeout: 20_000 });
    const terrainProjectionStats = await page.evaluate(() => ({
      projectionGroups: document.querySelectorAll('.street-communication-projection').length,
      spokes: document.querySelectorAll('.street-communication-spoke').length,
      samples: document.querySelectorAll('.street-communication-sample').length,
      footprints: document.querySelectorAll('.street-communication-footprint').length,
      currentLinks: document.querySelectorAll('.street-communication-current').length,
      debug: window.__taishanMapDebug?.(),
    }));
    report.terrain_projection_snapshot = terrainProjectionSnapshot;
    report.terrain_projection_stats = terrainProjectionStats;
    addCheck(
      report,
      'terrain imagery shows communication projection',
      terrainProjectionStats.projectionGroups === 1
        && terrainProjectionStats.spokes >= 3
        && terrainProjectionStats.samples >= 8
        && terrainProjectionStats.footprints === 1
        && terrainProjectionStats.currentLinks === 1,
      '2D terrain imagery should project the selected route communication diagnostic, not only show a circular radius',
      terrainProjectionStats,
    );

    await clickSegmentedButton(page, 0, 1);
    const basicCommunicationSnapshot = await waitForMapMode(page, 'basic_grid');
    await page.waitForFunction(() => (window.__taishanMapDebug?.().communicationEntityCount || 0) >= 12, null, { timeout: 20_000 });
    const basicProjectionSnapshot = await getDebug(page);
    report.basic_projection_snapshot = basicProjectionSnapshot;
    addCheck(
      report,
      'basic grid keeps communication terrain/profile entities',
      basicProjectionSnapshot.communicationEntityCount >= 12,
      'basic grid should still show communication projection/profile entities for the selected route',
      basicProjectionSnapshot,
    );

    await clickSegmentedButton(page, 0, 2);
    await waitForMapMode(page, 'photorealistic_3d_tiles');
    await page.waitForFunction(() => (window.__taishanMapDebug?.().communicationEntityCount || 0) >= 12, null, { timeout: 20_000 });

    const beforeCommunicationToggle = await getDebug(page);
    await page.locator('.communication-control input[type="checkbox"]').click();
    await page.waitForTimeout(800);
    const afterCommunicationOff = await getDebug(page);
    await page.locator('.communication-control input[type="checkbox"]').click();
    await page.waitForTimeout(1000);
    const afterCommunicationOn = await getDebug(page);
    const cameraDeltaAfterToggle = {
      height: Math.abs((afterCommunicationOn.cameraHeightMeters || 0) - (beforeCommunicationToggle.cameraHeightMeters || 0)),
      pitch: Math.abs((afterCommunicationOn.cameraPitchDegrees || 0) - (beforeCommunicationToggle.cameraPitchDegrees || 0)),
      heading: Math.abs((afterCommunicationOn.cameraHeadingDegrees || 0) - (beforeCommunicationToggle.cameraHeadingDegrees || 0)),
    };
    addCheck(
      report,
      'communication toggle does not move camera',
      afterCommunicationOff.communicationEntityCount === 0
        && afterCommunicationOn.communicationEntityCount >= 6
        && cameraDeltaAfterToggle.height <= 2
        && cameraDeltaAfterToggle.pitch <= 0.2
        && cameraDeltaAfterToggle.heading <= 0.2,
      'turning Fresnel corridor off/on should not fly, zoom, pan, or tilt the map',
      { beforeCommunicationToggle, afterCommunicationOff, afterCommunicationOn, cameraDeltaAfterToggle },
    );
    if (threeDSnapshot.clickablePoint) {
      await page.mouse.click(threeDSnapshot.clickablePoint.x, threeDSnapshot.clickablePoint.y);
      await page.waitForTimeout(700);
      const panelText = await page.locator('.right-panel').innerText();
      addCheck(report, '3D click updates property panel', /tower_id|route_id|waypoint_id|station_id|line_name|kml_file|analysis_type|通信遮挡演示/.test(panelText), 'clicking a 3D entity should expose business or communication properties', panelText.slice(0, 900));
    } else {
      addCheck(report, '3D click target optional when tiles are unavailable', true, 'click target can be absent when external 3D imagery is not configured in headless verification', threeDSnapshot);
    }

    const canvasBox = await page.locator('.cesium-stage canvas').first().boundingBox();
    addCheck(report, '3D canvas has interaction area', Boolean(canvasBox?.width && canvasBox?.height), 'canvas should have a measurable screen box', canvasBox);
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.48, canvasBox.y + canvasBox.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + canvasBox.height * 0.52, { steps: 12 });
    await page.mouse.up();
    await page.mouse.wheel(0, -650);
    await page.waitForTimeout(2500);
    const postMoveStatusText = await page.locator('.map-status').innerText();
    const postMoveSnapshot = await getDebug(page);
    report.post_move_snapshot = postMoveSnapshot;
    addCheck(report, '3D movement does not expose unavailable map tiles', !/map data not yet available/i.test(postMoveStatusText), 'drag/zoom should not show unavailable ArcGIS placeholder status', postMoveStatusText.slice(0, 1000));
    addCheck(report, 'scale updates after movement', Boolean(postMoveSnapshot.scaleLabel), 'scale label should remain available after camera movement', postMoveSnapshot);

    await page.screenshot({ path: screenshotPath, fullPage: false });
    report.status = 'passed';
    await writeMapReport(report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.error = error.message || String(error);
    if (page) {
      try {
        await page.screenshot({ path: failureScreenshotPath, fullPage: false });
      } catch (screenshotError) {
        report.screenshot_error = screenshotError.message || String(screenshotError);
      }
    }
    await writeMapReport(report);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
