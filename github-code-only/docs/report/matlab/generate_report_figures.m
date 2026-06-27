% generate_report_figures.m
% 泰山低空巡检无人机通信链路可靠性报告配套 MATLAB 图件
% 所有图件均为理论计算 / 模型示意 / 工程假设，用于技术预评估与参数敏感性分析。

clear; close all; clc;

scriptDir = fileparts(mfilename("fullpath"));
reportDir = fileparts(scriptDir);
outDir = fullfile(reportDir, "figures_matlab");
if ~exist(outDir, "dir")
    mkdir(outDir);
end

set(groot, "defaultFigureColor", "w");
set(groot, "defaultAxesFontName", "Microsoft YaHei");
set(groot, "defaultTextFontName", "Microsoft YaHei");
set(groot, "defaultAxesFontSize", 12);
set(groot, "defaultLineLineWidth", 1.8);

freqGHz = [0.92, 2.4, 5.8];
freqLabel = ["920 MHz", "2.4 GHz", "5.8 GHz"];
colors = [0.12 0.45 0.28; 0.12 0.42 0.70; 0.75 0.22 0.22];
distKm = linspace(0.5, 5.0, 450);

%% 1. FSPL 路径损耗曲线
fig = figure("Position", [100 100 1100 700]);
hold on; grid on; box on;
hFspl = gobjects(numel(freqGHz), 1);
for i = 1:numel(freqGHz)
    fspl = 92.45 + 20*log10(freqGHz(i)) + 20*log10(distKm);
    hFspl(i) = plot(distKm, fspl, "Color", colors(i, :));
end
xline(3, "--", "3 km", "Color", [0.55 0.55 0.55], "LabelOrientation", "horizontal", "HandleVisibility", "off");
xline(4, "--", "4 km", "Color", [0.55 0.55 0.55], "LabelOrientation", "horizontal", "HandleVisibility", "off");
yl = ylim;
patch([3 4 4 3], [yl(1) yl(1) yl(2) yl(2)], [1.0 0.94 0.75], ...
    "FaceAlpha", 0.25, "EdgeColor", "none", "HandleVisibility", "off");
uistack(findobj(gca, "Type", "patch"), "bottom");
xlabel("链路距离 d (km)");
ylabel("自由空间路径损耗 FSPL (dB)");
title("FSPL 路径损耗曲线");
legend(hFspl, freqLabel, "Location", "northwest");
set(gca, "GridColor", [0.82 0.82 0.82], "GridAlpha", 0.55, "LineWidth", 1.0);
text(0.55, yl(2)-3, "理论计算：实际链路预算需叠加天线、地形、多径和干扰项", "Color", [0.25 0.25 0.25]);
exportgraphics(fig, fullfile(outDir, "matlab_fig_01_fspl_curve.png"), "Resolution", 300);

%% 2. 第一菲涅尔区 F1 与 0.6F1 随距离变化
fig = figure("Position", [100 100 1100 700]);
hold on; grid on; box on;
c = 3e8;
D = distKm * 1000;
for i = 1:numel(freqGHz)
    lambda = c / (freqGHz(i) * 1e9);
    f1max = sqrt(lambda .* D ./ 4);
    plot(distKm, f1max, "-", "Color", colors(i, :), "DisplayName", freqLabel(i) + " F1");
    plot(distKm, 0.6*f1max, "--", "Color", colors(i, :), "DisplayName", freqLabel(i) + " 0.6F1");
end
xlabel("链路距离 D (km)");
ylabel("中点第一菲涅尔区半径 (m)");
title("第一菲涅尔区 F1 与 0.6F1 随距离变化");
legend("Location", "northwest", "NumColumns", 2);
set(gca, "GridColor", [0.82 0.82 0.82], "GridAlpha", 0.55, "LineWidth", 1.0);
text(0.55, max(ylim)-2, "理论计算：F1 取链路中点最大半径", "Color", [0.25 0.25 0.25]);
exportgraphics(fig, fullfile(outDir, "matlab_fig_02_fresnel_radius.png"), "Resolution", 300);

%% 3. 理论示意剖面与 0.6F1 净空判据
fig = figure("Position", [100 100 1100 700]);
hold on; grid on; box on;
xKm = linspace(0, 4.0, 500);
xM = xKm * 1000;
profile = 92 + 26*sin(xKm*2.0) + 118*exp(-((xKm-2.25)/0.42).^2) + 35*exp(-((xKm-3.2)/0.25).^2);
hG = 80;
hUav = 235;
Dtotal = max(xM);
hLos = hG + xM/Dtotal * (hUav - hG);
lambda = c / (2.4e9);
f1 = sqrt(max(0, lambda .* xM .* (Dtotal - xM) ./ Dtotal));
clearanceBoundary = hLos - 0.6*f1;
plot(xKm, profile, "Color", [0.25 0.45 0.18], "DisplayName", "h_{DEM}(x) 模型剖面");
plot(xKm, hLos, "Color", [0.12 0.42 0.70], "DisplayName", "h_{LoS}(x)");
plot(xKm, clearanceBoundary, "Color", [0.85 0.45 0.10], "DisplayName", "h_{LoS}(x)-0.6F1(x)");
area(xKm, profile, min(profile)-15, "FaceColor", [0.76 0.88 0.70], "FaceAlpha", 0.35, "EdgeColor", "none", "HandleVisibility", "off");
xlabel("剖面距离 x (km)");
ylabel("高程/高度 (m)");
title("理论示意剖面与 0.6F1 净空判据");
legend("Location", "northwest");
set(gca, "GridColor", [0.82 0.82 0.82], "GridAlpha", 0.55, "LineWidth", 1.0);
text(0.1, min(ylim)+8, "工程假设：定量应用需配置项目 DEM/DSM", "Color", [0.25 0.25 0.25]);
exportgraphics(fig, fullfile(outDir, "matlab_fig_03_dem_fresnel_clearance.png"), "Resolution", 300);

%% 4. 飞行高度对最小净空余量的影响
fig = figure("Position", [100 100 1100 700]);
hold on; grid on; box on;
heightList = 80:5:420;
minClearance = zeros(size(heightList));
for k = 1:numel(heightList)
    hLosK = hG + xM/Dtotal * (heightList(k) - hG);
    minClearance(k) = min(hLosK - profile - 0.6*f1);
end
plot(heightList, minClearance, "Color", [0.12 0.42 0.70]);
yline(0, "--", "0 m 净空阈值", "Color", [0.65 0.15 0.15]);
xlabel("无人机航点高度候选 h_{UAV} (m)");
ylabel("最小净空余量 min(C) (m)");
title("飞行高度对最小净空余量的影响");
set(gca, "GridColor", [0.82 0.82 0.82], "GridAlpha", 0.55, "LineWidth", 1.0);
text(min(heightList)+5, max(minClearance)-8, "工程假设：剖面和高度用于方法演示，需由 DEM/DSM 校准", "Color", [0.25 0.25 0.25]);
exportgraphics(fig, fullfile(outDir, "matlab_fig_04_height_clearance_margin.png"), "Resolution", 300);

%% 5. 距离-高度二维通信风险热力图
fig = figure("Position", [100 100 1100 700]);
distGrid = linspace(0.5, 5.0, 160);
heightGrid = linspace(60, 280, 160);
[Dg, Hg] = meshgrid(distGrid, heightGrid);
distanceRisk = min(1, max(0, (Dg - 2.0) / 3.0));
heightLowRisk = exp(-((Hg - 70) / 35).^2);
heightHighRisk = 0.35 * exp(-((Hg - 260) / 60).^2);
midHeightBenefit = 0.35 * exp(-((Hg - 180) / 55).^2);
sensitiveBand = double(Dg >= 3.0 & Dg <= 4.0) * 0.18;
risk = max(0, min(1, 0.45*distanceRisk + 0.35*heightLowRisk + heightHighRisk + sensitiveBand - midHeightBenefit));
imagesc(distGrid, heightGrid, risk);
set(gca, "YDir", "normal");
colormap(turbo);
cb = colorbar;
cb.Label.String = "归一化风险指数 R (0-1)";
hold on;
xline(3, "w--", "3 km", "LineWidth", 1.5);
xline(4, "w--", "4 km", "LineWidth", 1.5);
xlabel("链路距离 d (km)");
ylabel("飞行高度候选 h_{UAV} (m)");
title("距离-高度二维通信风险热力图");
clim([0 1]);
set(gca, "GridColor", [0.82 0.82 0.82], "GridAlpha", 0.40, "LineWidth", 1.0);
text(0.65, 268, "工程假设：用于解释距离/高度折中", "Color", "w", "FontWeight", "bold");
exportgraphics(fig, fullfile(outDir, "matlab_fig_05_distance_height_risk_heatmap.png"), "Resolution", 300);

%% 6. 电磁干扰暴露风险随近塔距离变化
fig = figure("Position", [100 100 1100 700]);
hold on; grid on; box on;
dNear = linspace(0, 300, 500);
d0List = [50, 80, 120];
emiColors = [0.75 0.22 0.22; 0.85 0.50 0.10; 0.12 0.42 0.70];
for i = 1:numel(d0List)
    rEmi = exp(-dNear / d0List(i));
    plot(dNear, rEmi, "Color", emiColors(i, :), "DisplayName", "d0 = " + d0List(i) + " m");
end
xlabel("距杆塔/高压设备最近距离 d (m)");
ylabel("R_{EMI}=exp(-d/d0)");
title("近塔距离与 EMI 暴露风险关系");
legend("Location", "northeast");
set(gca, "GridColor", [0.82 0.82 0.82], "GridAlpha", 0.55, "LineWidth", 1.0);
text(8, 0.08, "工程假设：R_EMI 用于电磁暴露排序", "Color", [0.25 0.25 0.25]);
exportgraphics(fig, fullfile(outDir, "matlab_fig_06_emi_distance_risk.png"), "Resolution", 300);

disp("MATLAB report figures exported to:");
disp(outDir);
