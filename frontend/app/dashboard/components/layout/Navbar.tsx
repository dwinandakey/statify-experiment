"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
} from "@/components/ui/menubar";

import { ModalType, useModal } from "@/hooks/useModal";
import FileMenu from "@/components/Modals/File/FileMenu";
import EditMenu from "@/components/Modals/Edit/EditMenu";
import DataMenu from "@/components/Modals/Data/DataMenu";
import GeneralLinearModelMenu from "@/components/Modals/Analyze/general-linear-model/general-linear-model-menu";
import ClassifyMenu from "@/components/Modals/Analyze/Classify/classify-menu";
import ClusteringMenu from "@/components/Modals/Analyze/Clustering/clustering-menu";
import DimensionReductionMenu from "@/components/Modals/Analyze/dimension-reduction/dimension-reduction-menu";
import TimeSeriesMenu from "@/components/Modals/Analyze/TimeSeries/TimeSeriesMenu";
import TransformMenu from "@/components/Modals/Transform/TransformMenu";

const Navbar: React.FC = () => {
  const { openModal } = useModal();
  const router = useRouter();

  const commonMenubarClasses = "ml-0 flex px-2 py-1 border-0";

  return (
    <nav className="bg-background border-b border-border" data-testid="main-navbar">
      <div className="flex items-center justify-between px-3 py-1.5">
        {/* Desktop: Single Menubar ONLY */}
        <Menubar className={commonMenubarClasses} data-testid="main-menubar">
          <FileMenu />
          <EditMenu />
          <DataMenu />
          <TransformMenu />
          <MenubarMenu>
            <MenubarTrigger data-testid="analyze-menu-trigger">Analyze</MenubarTrigger>
            <MenubarContent>
              <MenubarSub>
                <MenubarSubTrigger data-testid="descriptive-statistics-trigger">Descriptive Statistics</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onClick={() => openModal(ModalType.Frequencies)} data-testid="descriptive-statistics-frequencies">
                    Frequencies
                  </MenubarItem>
                  <MenubarItem
                    onClick={() => openModal(ModalType.Descriptives)}
                    data-testid="descriptive-statistics-descriptives"
                  >
                    Descriptives
                  </MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.Explore)} data-testid="descriptive-statistics-explore">
                    Explore
                  </MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.Crosstabs)} data-testid="descriptive-statistics-crosstabs">
                    Crosstabs
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger>Compare Means</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onClick={() => openModal(ModalType.OneSampleTTest)}>One-Sample T Test...</MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.IndependentSamplesTTest)}>Independent-Samples T Test...</MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.PairedSamplesTTest)}>Paired-Samples T Test...</MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.OneWayANOVA)}>One-Way ANOVA...</MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.BartlettTest)}>Bartlett&apos;s Test of Homogeneity...</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <GeneralLinearModelMenu />
              </MenubarSub>
              <MenubarSub>
                <ClusteringMenu />
              </MenubarSub>
              <MenubarSub>
                <ClassifyMenu />
              </MenubarSub>
              <MenubarSub>
                <DimensionReductionMenu />
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger>Correlate</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onClick={() => openModal(ModalType.Bivariate)}>Bivariate...</MenubarItem>
                  <MenubarItem disabled>Partial...</MenubarItem>
                  <MenubarItem disabled>Distances...</MenubarItem>
                  <MenubarItem disabled>Canonical Correlation...</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger>Regression</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onClick={() => openModal(ModalType.ModalLinear)}>
                    Linear...
                  </MenubarItem>
                  <MenubarItem
                    onClick={() => openModal(ModalType.ModalCurveEstimation)}
                  >
                    Curve Estimation...
                  </MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.ModalBinaryLogistic)}>
                    Binary Logistic...
                  </MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.ModalBinaryLogisticExperiment)}>
                    Binary Logistic (Experiment)...
                  </MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.ModalMultinomialLogistic)}>
                    Multinomial Logistic...
                  </MenubarItem>
                  <MenubarItem onClick={() => openModal(ModalType.ModalOrdinal)}>
                    Ordinal...
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger>Nonparametric Tests</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem disabled>One Sample...</MenubarItem>
                  <MenubarItem disabled>Independent Samples...</MenubarItem>
                  <MenubarItem disabled>Related Samples...</MenubarItem>
                  <MenubarSub>
                    <MenubarSubTrigger>Legacy Dialogs</MenubarSubTrigger>
                    <MenubarSubContent>
                      <MenubarItem onClick={() => openModal(ModalType.ChiSquare)}>Chi-square...</MenubarItem>
                      <MenubarItem onClick={() => openModal(ModalType.Runs)}>Runs...</MenubarItem>
                      <MenubarItem onClick={() => openModal(ModalType.TwoIndependentSamples)}>2 Independent Samples...</MenubarItem>
                      <MenubarItem onClick={() => openModal(ModalType.KIndependentSamples)}>K Independent Samples...</MenubarItem>
                      <MenubarItem onClick={() => openModal(ModalType.TwoRelatedSamples)}>2 Related Samples...</MenubarItem>
                      <MenubarItem onClick={() => openModal(ModalType.KRelatedSamples)}>K Related Samples...</MenubarItem>
                    </MenubarSubContent>
                  </MenubarSub>
                </MenubarSubContent>
              </MenubarSub>
              <TimeSeriesMenu />
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger data-testid="graphs-menu-trigger">Graphs</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                onClick={() => openModal(ModalType.ChartBuilderModal)}
              >
                Chart Builder...
              </MenubarItem>
              <MenubarItem disabled>Graphboard Template Chooser...</MenubarItem>
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger>Legacy Dialogs</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    onClick={() => openModal(ModalType.SimpleBarModal)}
                  >
                    Bar...
                  </MenubarItem>
                  <MenubarItem disabled>3-D Bar...</MenubarItem>
                  <MenubarItem disabled>Line</MenubarItem>
                  <MenubarItem disabled>Area</MenubarItem>
                  <MenubarItem disabled>Pie</MenubarItem>
                  <MenubarItem disabled>High-Low</MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem disabled>Box-Plot...</MenubarItem>
                  <MenubarItem disabled>Error Bar...</MenubarItem>
                  <MenubarItem disabled>Population Pyramid</MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem disabled>Scatter/Dot...</MenubarItem>
                  <MenubarItem disabled>Histogram...</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger data-testid="help-menu-trigger" onClick={() => router.push("/help")}>Help</MenubarTrigger>
          </MenubarMenu>
        </Menubar>
        <div className="font-sans text-lg font-semibold text-foreground" data-testid="app-logo">
          Statify
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
