"use client";

import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  MenuIcon,
  FileIcon,
  EditIcon,
  DatabaseIcon,
  WandIcon,
  BarChartIcon,
  LineChartIcon,
  HelpCircleIcon,
  ChevronRightIcon,
} from "lucide-react";

import { useModal, ModalType } from "@/hooks/useModal";
import { useFileMenuActions } from "@/components/Modals/File/Actions/useFileMenuActions";
import { useEditMenuActions } from "@/components/Modals/Edit/Actions/useEditMenuActions";
import { FindReplaceMode } from "@/components/Modals/Edit/FindReplace/types";
import { GoToMode } from "@/components/Modals/Edit/GoTo/types";
// NOTE: We don't need useMobile *inside* this component,
// it will be rendered conditionally by its parent.

// Helper component for simple menu items inside the Accordion
const DrawerMenuItem: React.FC<{
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ onClick, children, disabled }) => (
  <Button
    variant="ghost"
    className="w-full justify-start px-2 py-1 text-xs font-normal h-auto text-left whitespace-normal text-muted-foreground hover:text-foreground hover:bg-accent rounded-none border-l-2 border-transparent hover:border-accent-foreground"
    onClick={onClick}
    disabled={disabled}
  >
    <ChevronRightIcon className="h-3 w-3 mr-1.5 text-muted-foreground" />
    {children}
  </Button>
);

// Helper component for nested Accordion triggers
const NestedAccordionTrigger: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <AccordionTrigger className="text-xs font-medium py-1.5 px-2 hover:no-underline text-foreground hover:text-foreground bg-accent border-l-2 border-border">
    {children}
  </AccordionTrigger>
);

// Helper component for separators
const DrawerMenuSeparator = () => <hr className="my-0.5 border-border" />;

const HamburgerMenu: React.FC = () => {
  const { openModal } = useModal();
  const { handleAction: handleFileAction } = useFileMenuActions();
  const { handleAction: handleEditAction } = useEditMenuActions();

  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-background"
      data-testid="mobile-header"
    >
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="px-1.5 hover:bg-accent"
            data-testid="hamburger-menu-trigger"
          >
            <MenuIcon className="h-5 w-5 text-foreground" />
            <span className="sr-only">Open Menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="overflow-y-auto w-[85vw] sm:w-[300px] p-0 border-r border-border bg-background"
          data-testid="mobile-menu-content"
        >
          <SheetHeader className="px-4 py-3 border-b border-border">
            <SheetTitle className="text-sm font-medium text-foreground">
              Menu
            </SheetTitle>
            <SheetDescription className="sr-only">
              Main navigation menu for the application.
            </SheetDescription>
          </SheetHeader>
          <div className="py-1 overflow-y-auto">
            <Accordion
              type="multiple"
              className="w-full"
              data-testid="mobile-menu-accordion"
            >
              {/* --- File Accordion Item --- */}
              <AccordionItem
                value="file"
                className="border-b border-border"
                data-testid="mobile-file-menu"
              >
                <AccordionTrigger className="px-4 py-2 text-sm font-medium text-foreground hover:text-foreground hover:bg-accent bg-background">
                  <div className="flex items-center">
                    <FileIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>File</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col space-y-0.5 pl-4 pr-0 pb-1 pt-0 bg-background">
                  <DrawerMenuItem
                    onClick={() => handleFileAction({ actionType: "New" })}
                  >
                    New
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => handleFileAction({ actionType: "Save" })}
                  >
                    Save
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => handleFileAction({ actionType: "SaveAs" })}
                  >
                    Save As...
                  </DrawerMenuItem>
                  <DrawerMenuItem onClick={() => openModal(ModalType.OpenData)}>
                    Open Data
                  </DrawerMenuItem>
                  {/* Import Data Items */}
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.ImportExcel)}
                  >
                    Import Excel...
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.ImportCSV)}
                  >
                    Import CSV Data...
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  {/* Export Items */}
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.ExportExcel)}
                  >
                    Export Excel...
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.ExportCSV)}
                  >
                    Export CSV Data...
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem onClick={() => openModal(ModalType.Print)}>
                    Print...
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem
                    onClick={() => handleFileAction({ actionType: "Exit" })}
                  >
                    Exit
                  </DrawerMenuItem>
                </AccordionContent>
              </AccordionItem>

              {/* --- Edit Accordion Item --- */}
              <AccordionItem value="edit" className="border-b border-border">
                <AccordionTrigger className="px-4 py-2 text-sm font-medium text-foreground hover:text-foreground hover:bg-accent bg-background">
                  <div className="flex items-center">
                    <EditIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>Edit</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col space-y-0.5 pl-4 pr-0 pb-1 pt-0 bg-background">
                  <DrawerMenuItem onClick={() => handleEditAction("Cut")}>
                    Cut
                  </DrawerMenuItem>
                  <DrawerMenuItem onClick={() => handleEditAction("Copy")}>
                    Copy
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => handleEditAction("CopyWithVariableNames")}
                    disabled={false}
                  >
                    Copy with Variable Names
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => handleEditAction("CopyWithVariableLabels")}
                    disabled={false}
                  >
                    Copy with Variable Labels
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem onClick={() => handleEditAction("Paste")}>
                    Paste
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => handleEditAction("PasteVariables")}
                    disabled={false}
                  >
                    Paste Variables...
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => handleEditAction("PasteWithVariableNames")}
                    disabled={false}
                  >
                    Paste with Variable Names
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem onClick={() => handleEditAction("Clear")}>
                    Clear
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem
                    onClick={() => handleEditAction("InsertVariable")}
                    disabled={false}
                  >
                    Insert Variable
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() => handleEditAction("InsertCases")}
                    disabled={false}
                  >
                    Insert Cases
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem
                    onClick={() =>
                      openModal(ModalType.FindAndReplace, {
                        initialTab: FindReplaceMode.FIND,
                      })
                    }
                  >
                    Find...
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() =>
                      openModal(ModalType.FindAndReplace, {
                        initialTab: FindReplaceMode.REPLACE,
                      })
                    }
                  >
                    Replace...
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() =>
                      openModal(ModalType.GoTo, { initialMode: GoToMode.CASE })
                    }
                  >
                    Go to Case...
                  </DrawerMenuItem>
                  <DrawerMenuItem
                    onClick={() =>
                      openModal(ModalType.GoTo, {
                        initialMode: GoToMode.VARIABLE,
                      })
                    }
                  >
                    Go to Variable...
                  </DrawerMenuItem>
                </AccordionContent>
              </AccordionItem>

              {/* --- Data Accordion Item --- */}
              <AccordionItem value="data" className="border-b border-border">
                <AccordionTrigger className="px-4 py-2 text-sm font-medium text-foreground hover:text-foreground hover:bg-accent bg-background">
                  <div className="flex items-center">
                    <DatabaseIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>Data</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col space-y-0.5 pl-4 pr-0 pb-1 pt-0 bg-background">
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.DefineVarProps)}
                  >
                    Define Variable Properties...
                  </DrawerMenuItem>
                  {/* <DrawerMenuItem onClick={() => openModal(ModalType.SetMeasurementLevel)}>Set Measurement Level...</DrawerMenuItem> */}
                  {/* <DrawerMenuItem onClick={() => openModal(ModalType.DefineDateTime)}>Define Date and Time...</DrawerMenuItem> */}
                  <DrawerMenuSeparator />
                  {/* <DrawerMenuItem onClick={() => openModal(ModalType.DuplicateCases)}>Identify Duplicate Cases...</DrawerMenuItem> */}
                  {/* <DrawerMenuItem onClick={() => openModal(ModalType.UnusualCases)}>Identify Unusual Cases...</DrawerMenuItem> */}
                  <DrawerMenuSeparator />
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.SortCases)}
                  >
                    Sort Cases...
                  </DrawerMenuItem>
                  <DrawerMenuItem onClick={() => openModal(ModalType.SortVars)}>
                    Sort Variables...
                  </DrawerMenuItem>
                  {/* <DrawerMenuItem onClick={() => openModal(ModalType.Transpose)}>Transpose...</DrawerMenuItem> */}
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.Aggregate)}
                  >
                    Aggregate...
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  {/* <DrawerMenuItem onClick={() => openModal(ModalType.WeightCases)}>Weight Cases...</DrawerMenuItem> */}
                </AccordionContent>
              </AccordionItem>

              {/* --- Transform Accordion Item --- */}
              <AccordionItem
                value="transform"
                className="border-b border-border"
              >
                <AccordionTrigger className="px-4 py-2 text-sm font-medium text-foreground hover:text-foreground hover:bg-accent bg-background">
                  <div className="flex items-center">
                    <WandIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>Transform</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col space-y-0.5 pl-4 pr-0 pb-1 pt-0 bg-background">
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.ComputeVariable)}
                  >
                    Compute Variable...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>
                    Programmability Transformation...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>
                    Count Values within Cases...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>Shift Values...</DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.RecodeSameVariables)}
                  >
                    Recode into Same Variables...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>
                    Recode into Different Variables...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>Automatic Recode...</DrawerMenuItem>
                  <DrawerMenuItem disabled>
                    Create Dummy Variables...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>Visual Binning...</DrawerMenuItem>
                  <DrawerMenuItem disabled>Optimal Binning...</DrawerMenuItem>
                  <DrawerMenuItem disabled>
                    Prepare Data for Modeling
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem
                    onClick={() => openModal(ModalType.RankCases)}
                  >
                    Rank Case...
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem disabled>
                    Date and Time Wizard...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>
                    Create Time Series...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>
                    Replace Missing Values...
                  </DrawerMenuItem>
                  <DrawerMenuItem disabled>
                    Random Number Generators...
                  </DrawerMenuItem>
                  <DrawerMenuSeparator />
                  <DrawerMenuItem disabled>
                    Run Pending Transforms
                  </DrawerMenuItem>
                </AccordionContent>
              </AccordionItem>

              {/* --- Analyze Accordion Item --- */}
              <AccordionItem value="analyze" className="border-b border-border">
                <AccordionTrigger className="px-4 py-2 text-sm font-medium text-foreground hover:text-foreground hover:bg-accent bg-background">
                  <div className="flex items-center">
                    <BarChartIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>Analyze</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pl-4 pr-0 pb-1 pt-0 bg-background">
                  <Accordion type="multiple" className="w-full">
                    <AccordionItem value="desc-stats" className="border-0">
                      <NestedAccordionTrigger>
                        Descriptive Statistics
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-6 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.Descriptives)}
                        >
                          Descriptives...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.Explore)}
                        >
                          Explore...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.Frequencies)}
                        >
                          Frequencies...
                        </DrawerMenuItem>
                        {/* <DrawerMenuItem onClick={() => openModal(ModalType.Crosstabs)}>Crosstabs...</DrawerMenuItem> */}
                        <DrawerMenuSeparator />
                        {/* Ratio: Opens a modal for ratio statistics */}
                        {/* <DrawerMenuItem onClick={() => openModal(ModalType.Ratio)}>Ratio...</DrawerMenuItem> */}
                        {/* P-P Plots: Opens a modal for P-P plot generation */}
                        {/* <DrawerMenuItem onClick={() => openModal(ModalType.PPPlots)}>P-P Plots...</DrawerMenuItem> */}
                        {/* Q-Q Plots: Opens a modal for Q-Q plot generation */}
                        {/* <DrawerMenuItem onClick={() => openModal(ModalType.QQPlots)}>Q-Q Plots...</DrawerMenuItem> */}
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="compare-means" className="border-0">
                      <NestedAccordionTrigger>
                        Compare Means
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.OneSampleTTest)}
                        >
                          One-Sample T Test...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.IndependentSamplesTTest)
                          }
                        >
                          Independent-Samples T Test...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.PairedSamplesTTest)
                          }
                        >
                          Paired-Samples T Test...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.OneWayANOVA)}
                        >
                          One-Way ANOVA...
                        </DrawerMenuItem>
                        <DrawerMenuItem onClick={() => openModal(ModalType.BartlettTest)}>
                          Bartlett&apos;s Test of Homogeneity...
                        </DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="glm" className="border-0">
                      <NestedAccordionTrigger>
                        General Linear Model
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ModalUnivariate)}
                        >
                          Univariate...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ModalMultivariate)}
                        >
                          Multivariate...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalRepeatedMeasures)
                          }
                        >
                          Repeated Measures...
                        </DrawerMenuItem>
                        <DrawerMenuSeparator />
                        <DrawerMenuItem disabled>
                          Variance Components...
                        </DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="classify" className="border-0">
                      <NestedAccordionTrigger>Classify</NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalDiscriminant)
                          }
                        >
                          Discriminant...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalNearestNeighbor)
                          }
                        >
                          Nearest Neighbor...
                        </DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="clustering" className="border-0">
                      <NestedAccordionTrigger>
                        Clustering
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalKMeansCluster)
                          }
                        >
                          K-Means Cluster...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalKMedoidsCluster)
                          }
                        >
                          K-Medoids Cluster...
                        </DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem
                      value="dimension-reduction"
                      className="border-0"
                    >
                      <NestedAccordionTrigger>
                        Dimension Reduction
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ModalFactor)}
                        >
                          Factor...
                        </DrawerMenuItem>
                        <DrawerMenuItem disabled>
                          Correspondence Analysis...
                        </DrawerMenuItem>
                        <DrawerMenuItem disabled>
                          Optimal Scaling...
                        </DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="correlate" className="border-0">
                      <NestedAccordionTrigger>Correlate</NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.Bivariate)}
                        >
                          Bivariate...
                        </DrawerMenuItem>
                        <DrawerMenuItem disabled>Partial...</DrawerMenuItem>
                        <DrawerMenuItem disabled>Distances...</DrawerMenuItem>
                        <DrawerMenuItem disabled>
                          Canonical Correlation...
                        </DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="regression" className="border-0">
                      <NestedAccordionTrigger>
                        Regression
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalAutomaticLinearModeling)
                          }
                        >
                          Automatic Linear Modeling...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ModalLinear)}
                        >
                          Linear...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalCurveEstimation)
                          }
                        >
                          Curve Estimation...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalPartialLeastSquares)
                          }
                        >
                          Partial Least Squares...
                        </DrawerMenuItem>
                        <DrawerMenuSeparator />
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalBinaryLogistic)
                          }
                        >
                          Binary Logistic...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalBinaryLogisticExperiment)
                          }
                        >
                          Binary Logistic (Experiment)...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalMultinomialLogistic)
                          }
                        >
                          Multinomial Logistic...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ModalOrdinal)}
                        >
                          Ordinal...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ModalProbit)}
                        >
                          Probit...
                        </DrawerMenuItem>
                        <DrawerMenuSeparator />
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ModalNonlinear)}
                        >
                          Nonlinear...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalWeightEstimation)
                          }
                        >
                          Weight Estimation...
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalTwoStageLeastSquares)
                          }
                        >
                          2-Stage Least Squares...
                        </DrawerMenuItem>
                        <DrawerMenuSeparator />
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ModalQuantiles)}
                        >
                          Quantiles...
                        </DrawerMenuItem>
                        <DrawerMenuSeparator />
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.ModalOptimalScaling)
                          }
                        >
                          Optimal Scaling (Catreg)...
                        </DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="nonparametric" className="border-0">
                      <NestedAccordionTrigger>
                        Nonparametric Test
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem disabled>One Sample...</DrawerMenuItem>
                        <DrawerMenuItem disabled>
                          Independent Samples...
                        </DrawerMenuItem>
                        <DrawerMenuItem disabled>
                          Related Samples...
                        </DrawerMenuItem>
                        <Accordion type="multiple" className="w-full">
                          <AccordionItem
                            value="legacy-dialogs-nonparametric"
                            className="border-0"
                          >
                            <NestedAccordionTrigger>
                              Legacy Dialogs
                            </NestedAccordionTrigger>
                            <AccordionContent className="flex flex-col space-y-0.5 pl-6 pr-0 pb-1 pt-0 bg-accent">
                              <DrawerMenuItem
                                onClick={() =>
                                  openModal(ModalType.ChiSquare)
                                }
                              >
                                Chi-square...
                              </DrawerMenuItem>
                              <DrawerMenuItem
                                onClick={() => openModal(ModalType.Runs)}
                              >
                                Runs...
                              </DrawerMenuItem>
                              <DrawerMenuItem
                                onClick={() =>
                                  openModal(ModalType.TwoIndependentSamples)
                                }
                              >
                                2 Independent Samples...
                              </DrawerMenuItem>
                              <DrawerMenuItem
                                onClick={() =>
                                  openModal(ModalType.KIndependentSamples)
                                }
                              >
                                K Independent Samples...
                              </DrawerMenuItem>
                              <DrawerMenuItem
                                onClick={() =>
                                  openModal(ModalType.TwoRelatedSamples)
                                }
                              >
                                2 Related Samples...
                              </DrawerMenuItem>
                              <DrawerMenuItem
                                onClick={() =>
                                  openModal(ModalType.KRelatedSamples)
                                }
                              >
                                K Related Samples...
                              </DrawerMenuItem>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="time-series" className="border-0">
                      <NestedAccordionTrigger>
                        Time Series
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-3 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.Decomposition)}
                        >
                          Decomposition
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.Smoothing)}
                        >
                          Smoothing
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.Autocorrelation)}
                        >
                          Autocorrelation
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.UnitRootTest)}
                        >
                          Unit Root Test
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.BoxJenkinsModel)}
                        >
                          Box-Jenkins Model
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ARDL)}
                        >
                          Autoregressive Distributed Lag
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.ECM)}
                        >
                          Error Correction Model
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.HomoscedasticityTest)
                          }
                        >
                          Homoscedasticity Test (ARCH-LM)
                        </DrawerMenuItem>
                        <DrawerMenuItem
                          onClick={() =>
                            openModal(ModalType.HeteroskedasticityModels)
                          }
                        >
                          Heteroscedasticity Models (ARCH/GARCH)
                        </DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </AccordionContent>
              </AccordionItem>

              {/* --- Graphs Accordion Item --- */}
              <AccordionItem value="graphs" className="border-b border-border">
                <AccordionTrigger className="px-4 py-2 text-sm font-medium text-foreground hover:text-foreground hover:bg-accent bg-background">
                  <div className="flex items-center">
                    <LineChartIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>Graphs</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pl-4 pr-0 pb-1 pt-0 bg-background">
                  <Accordion type="multiple" className="w-full">
                    <AccordionItem value="chart-builder" className="border-0">
                      <DrawerMenuItem
                        onClick={() => openModal(ModalType.ChartBuilderModal)}
                      >
                        Chart Builder...
                      </DrawerMenuItem>
                      <DrawerMenuItem disabled>
                        Graphboard Template Chooser...
                      </DrawerMenuItem>
                    </AccordionItem>
                    <DrawerMenuSeparator />
                    <AccordionItem
                      value="legacy-dialogs-graphs"
                      className="border-0"
                    >
                      <NestedAccordionTrigger>
                        Legacy Dialogs
                      </NestedAccordionTrigger>
                      <AccordionContent className="flex flex-col space-y-0.5 pl-6 pr-0 pb-1 pt-0 bg-accent">
                        <DrawerMenuItem
                          onClick={() => openModal(ModalType.SimpleBarModal)}
                        >
                          Bar...
                        </DrawerMenuItem>
                        <DrawerMenuItem disabled>3-D Bar...</DrawerMenuItem>
                        <DrawerMenuItem disabled>Line</DrawerMenuItem>
                        <DrawerMenuItem disabled>Area</DrawerMenuItem>
                        <DrawerMenuItem disabled>Pie</DrawerMenuItem>
                        <DrawerMenuItem disabled>High-Low</DrawerMenuItem>
                        <DrawerMenuSeparator />
                        <DrawerMenuItem disabled>Box-Plot...</DrawerMenuItem>
                        <DrawerMenuItem disabled>Error Bar...</DrawerMenuItem>
                        <DrawerMenuItem disabled>
                          Population Pyramid
                        </DrawerMenuItem>
                        <DrawerMenuSeparator />
                        <DrawerMenuItem disabled>Scatter/Dot...</DrawerMenuItem>
                        <DrawerMenuItem disabled>Histogram...</DrawerMenuItem>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </AccordionContent>
              </AccordionItem>

              {/* --- Help Accordion Item --- */}
              <AccordionItem value="help" className="border-b-0">
                <AccordionTrigger
                  className="px-4 py-2 text-sm font-medium text-foreground hover:text-foreground hover:bg-accent bg-background"
                  disabled
                >
                  <div className="flex items-center">
                    <HelpCircleIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>Help</span>
                  </div>
                </AccordionTrigger>
                {/* Help content can be added here if needed in the future */}
              </AccordionItem>
            </Accordion>
          </div>
        </SheetContent>
      </Sheet>
      <div className="font-sans text-base font-semibold text-foreground">
        Statify
      </div>
    </div>
  );
};

export default HamburgerMenu;
