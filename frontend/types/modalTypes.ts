import React from "react";

/**
 * ModalType - Enum untuk semua tipe modal dalam aplikasi
 *
 * Digunakan untuk:
 * 1. Mengidentifikasi modal secara unik
 * 2. Menjamin type-safety dalam kode
 * 3. Memudahkan autocomplete saat pengembangan
 */
export enum ModalType {
    // File modals - Operasi file seperti import, export, print
    ImportCSV = "ImportCSV",
    ReadCSVFile = "ReadCSVFile",
    ImportExcel = "ImportExcel",
    ReadExcelFile = "ReadExcelFile",
    OpenData = "OpenData",
    OpenOutput = "OpenOutput",
    PrintPreview = "PrintPreview",
    Print = "Print",
    ExportCSV = "ExportCSV",
    ExportExcel = "ExportExcel",
    Exit = "Exit",
    ImportClipboard = "ImportClipboard",

    // Edit modals - Operasi pencarian dan navigasi
    FindAndReplace = "FindAndReplace",
    GoTo = "GoTo",
    Find = "Find",
    Replace = "Replace",
    GoToCase = "GoToCase",
    GoToVariable = "GoToVariable",

    // Data modals - Operasi manipulasi dan pengaturan data
    DefineVarProps = "DefineVarProps",
    VarPropsEditor = "VarPropsEditor",
    SetMeasurementLevel = "SetMeasurementLevel",
    DefineDateTime = "DefineDateTime",
    DuplicateCases = "DuplicateCases",
    UnusualCases = "UnusualCases",
    SortCases = "SortCases",
    SortVars = "SortVars",
    Transpose = "Transpose",
    Restructure = "Restructure",
    Aggregate = "Aggregate",
    MergeFiles = "MergeFiles",
    SplitFile = "SplitFile",
    WeightCases = "WeightCases",
    MultipleResponse = "MultipleResponse",
    NewCustomAttr = "NewCustomAttr",
    SelectCases = "SelectCases",
    DefineValidationRules = "DefineValidationRules",
    Validate = "Validate",
    ExampleDataset = "ExampleDataset",

    // Transform modals - Transformasi variabel dan data
    ComputeVariable = "ComputeVariable",
    RecodeSameVariables = "RecodeSameVariables",
    RecodeDifferentVariables = "RecodeDifferentVariables",
    StringToWordVector = "StringToWordVector",
    RankCases = "RankCases",

    // Regression modals - Analisis regresi dan model terkait
    ModalAutomaticLinearModeling = "ModalAutomaticLinearModeling",
    ModalLinear = "ModalLinear",
    Statistics = "Statistics",
    SaveLinear = "SaveLinear",
    OptionsLinear = "OptionsLinear",
    PlotsLinear = "PlotsLinear",
    ModalCurveEstimation = "ModalCurveEstimation",
    ModalPartialLeastSquares = "ModalPartialLeastSquares",
    ModalBinaryLogistic = "ModalBinaryLogistic",
    ModalBinaryLogisticExperiment = "ModalBinaryLogisticExperiment",
    ModalMultinomialLogistic = "ModalMultinomialLogistic",
    ModalOrdinal = "ModalOrdinal",
    ModalProbit = "ModalProbit",
    ModalNonlinear = "ModalNonlinear",
    ModalWeightEstimation = "ModalWeightEstimation",
    ModalTwoStageLeastSquares = "ModalTwoStageLeastSquares",
    ModalQuantiles = "ModalQuantiles",
    ModalOptimalScaling = "ModalOptimalScaling",

    // Chart modals - Pembuatan dan konfigurasi grafik
    ChartBuilderModal = "ChartBuilderModal",
    SimpleBarModal = "SimpleBarModal",

    // Time series modals - Analisis deret waktu
    Smoothing = "Smoothing",
    Decomposition = "Decomposition",
    Autocorrelation = "Autocorrelation",
    UnitRootTest = "UnitRootTest",
    BoxJenkinsModel = "BoxJenkinsModel",
    ARCH = "ARCH",
    GARCH = "GARCH",
    ECM = "ECM",
    ARDL = "ARDL",
    HomoscedasticityTest = "HomoscedasticityTest",
    HeteroskedasticityModels = "HeteroskedasticityModels",


    // Descriptive statistics modals
    Descriptives = "Descriptives",
    Explore = "Explore",
    Frequencies = "Frequencies",
    Crosstabs = "Crosstabs",
    Ratio = "Ratio",
    PPPlots = "PPPlots",
    QQPlots = "QQPlots",

    // Compare Means modals
    OneSampleTTest = "OneSampleTTest",
    IndependentSamplesTTest = "IndependentSamplesTTest",
    PairedSamplesTTest = "PairedSamplesTTest",
    OneWayANOVA = "OneWayANOVA",
    BartlettTest = "BartlettTest",

    // Correlate modals
    Bivariate = "Bivariate",

    // General Linear Model modals
    ModalUnivariate = "ModalUnivariate",
    ModalMultivariate = "ModalMultivariate",
    ModalRepeatedMeasures = "ModalRepeatedMeasures",
    ModalVarianceComponents = "ModalVarianceComponents",

    // Classify modals
    ModalTwoStepCluster = "ModalTwoStepCluster",
    ModalKMeansCluster = "ModalKMeansCluster",
    ModalKMedoidsCluster = "ModalKMedoidsCluster",
    ModalHierarchicalCluster = "ModalHierarchicalCluster",
    ModalClusterSilhouettes = "ModalClusterSilhouettes",
    ModalTree = "ModalTree",
    ModalDiscriminant = "ModalDiscriminant",
    ModalNearestNeighbor = "ModalNearestNeighbor",
    ModalNaiveBayes = "ModalNaiveBayes",
    ModalApplyModel = "ModalApplyModel",
    ModalROCCurve = "ModalROCCurve",
    ModalROCAnalysis = "ModalROCAnalysis",

    // Dimension Reduction modals
    ModalFactor = "ModalFactor",
    ModalCorrespondenceAnalysis = "ModalCorrespondenceAnalysis",
    ModalDROptimalScaling = "ModalDROptimalScaling",
    ModalOptimalScalingCATPCA = "ModalOptimalScalingCATPCA",
    ModalOptimalScalingOVERALS = "ModalOptimalScalingOVERALS",
    ModalOptimalScalingMCA = "ModalOptimalScalingMCA",

    // Nonparametric Tests modals
    ChiSquare = "ChiSquare",
    Runs = "Runs",
    TwoIndependentSamples = "TwoIndependentSamples",
    KIndependentSamples = "KIndependentSamples",
    TwoRelatedSamples = "TwoRelatedSamples",
    KRelatedSamples = "KRelatedSamples",
}

/**
 * ModalCategory - Kategori untuk pengelompokan modal
 *
 * Digunakan untuk mengorganisir modal berdasarkan fungsi
 * dan menempatkannya dalam menu yang sesuai.
 */
export enum ModalCategory {
    File = "File",
    Data = "Data",
    Edit = "Edit",
    Transform = "Transform",
    Analyze = "Analyze",
    Regression = "Regression",
    Graphs = "Graphs",
    TimeSeries = "TimeSeries",
}

/**
 * BaseModalProps - Interface dasar untuk props semua modal
 *
 * Semua komponen modal harus menerima props ini.
 * Untuk mendukung fleksibilitas, beberapa props yang diperlukan oleh
 * komponen modal tertentu dibuat opsional dengan tanda tanya (?)
 */
export interface BaseModalProps {
    // Props wajib untuk semua modal
    onClose: () => void;
    containerType?: "dialog" | "sidebar";

    // Container override untuk memaksa tipe container tertentu
    containerOverride?: "dialog" | "sidebar";

    // Props opsional untuk modal tertentu
    isOpen?: boolean; // Untuk file modals
    params?: any; // Untuk regression modals
    onChange?: (params: any) => void; // Untuk regression modals
    availablePlotVariables?: any[]; // Untuk PlotsLinear

    // Mendukung props tambahan lainnya
    [key: string]: any;
}

/**
 * ModalMetadata - Metadata untuk modal
 *
 * Berisi informasi tambahan tentang modal yang dapat
 * digunakan untuk UI atau logika khusus.
 */
export interface ModalMetadata {
    type: ModalType;
    category: ModalCategory;
    title: string;
    description?: string;
    preferredContainer?: "dialog" | "sidebar";
}

/**
 * MODAL_CATEGORIES - Pemetaan modal ke kategori
 *
 * Setiap ModalType dipetakan ke ModalCategory yang sesuai.
 */
export const MODAL_CATEGORIES: Record<ModalType, ModalCategory> = {
    // File modals
    [ModalType.ImportCSV]: ModalCategory.File,
    [ModalType.ReadCSVFile]: ModalCategory.File,
    [ModalType.ImportExcel]: ModalCategory.File,
    [ModalType.ReadExcelFile]: ModalCategory.File,
    [ModalType.OpenData]: ModalCategory.File,
    [ModalType.OpenOutput]: ModalCategory.File,
    [ModalType.PrintPreview]: ModalCategory.File,
    [ModalType.Print]: ModalCategory.File,
    [ModalType.ExportCSV]: ModalCategory.File,
    [ModalType.ExportExcel]: ModalCategory.File,
    [ModalType.Exit]: ModalCategory.File,
    [ModalType.ImportClipboard]: ModalCategory.File,

    // Edit modals
    [ModalType.FindAndReplace]: ModalCategory.Edit,
    [ModalType.GoTo]: ModalCategory.Edit,
    [ModalType.Find]: ModalCategory.Edit,
    [ModalType.Replace]: ModalCategory.Edit,
    [ModalType.GoToCase]: ModalCategory.Edit,
    [ModalType.GoToVariable]: ModalCategory.Edit,

    // Data modals
    [ModalType.DefineVarProps]: ModalCategory.Data,
    [ModalType.VarPropsEditor]: ModalCategory.Data,
    [ModalType.SetMeasurementLevel]: ModalCategory.Data,
    [ModalType.DefineDateTime]: ModalCategory.Data,
    [ModalType.DuplicateCases]: ModalCategory.Data,
    [ModalType.UnusualCases]: ModalCategory.Data,
    [ModalType.SortCases]: ModalCategory.Data,
    [ModalType.SortVars]: ModalCategory.Data,
    [ModalType.Transpose]: ModalCategory.Data,
    [ModalType.Restructure]: ModalCategory.Data,
    [ModalType.Aggregate]: ModalCategory.Data,
    [ModalType.MergeFiles]: ModalCategory.Data,
    [ModalType.SplitFile]: ModalCategory.Data,
    [ModalType.WeightCases]: ModalCategory.Data,
    [ModalType.MultipleResponse]: ModalCategory.Data,
    [ModalType.NewCustomAttr]: ModalCategory.Data,
    [ModalType.SelectCases]: ModalCategory.Data,
    [ModalType.DefineValidationRules]: ModalCategory.Data,
    [ModalType.Validate]: ModalCategory.Data,
    [ModalType.ExampleDataset]: ModalCategory.Data,

    // Transform modals
    [ModalType.ComputeVariable]: ModalCategory.Transform,
    [ModalType.RecodeSameVariables]: ModalCategory.Transform,
    [ModalType.RecodeDifferentVariables]: ModalCategory.Transform,
    [ModalType.StringToWordVector]: ModalCategory.Transform,
    [ModalType.RankCases]: ModalCategory.Transform,

    // Regression modals
    [ModalType.ModalAutomaticLinearModeling]: ModalCategory.Regression,
    [ModalType.ModalLinear]: ModalCategory.Regression,
    [ModalType.Statistics]: ModalCategory.Regression,
    [ModalType.SaveLinear]: ModalCategory.Regression,
    [ModalType.OptionsLinear]: ModalCategory.Regression,
    [ModalType.PlotsLinear]: ModalCategory.Regression,
    [ModalType.ModalCurveEstimation]: ModalCategory.Regression,
    [ModalType.ModalPartialLeastSquares]: ModalCategory.Regression,
    [ModalType.ModalBinaryLogistic]: ModalCategory.Regression,
    [ModalType.ModalBinaryLogisticExperiment]: ModalCategory.Regression,
    [ModalType.ModalMultinomialLogistic]: ModalCategory.Regression,
    [ModalType.ModalOrdinal]: ModalCategory.Regression,
    [ModalType.ModalProbit]: ModalCategory.Regression,
    [ModalType.ModalNonlinear]: ModalCategory.Regression,
    [ModalType.ModalWeightEstimation]: ModalCategory.Regression,
    [ModalType.ModalTwoStageLeastSquares]: ModalCategory.Regression,
    [ModalType.ModalQuantiles]: ModalCategory.Regression,
    [ModalType.ModalOptimalScaling]: ModalCategory.Regression,

    // Chart modals
    [ModalType.ChartBuilderModal]: ModalCategory.Graphs,
    [ModalType.SimpleBarModal]: ModalCategory.Graphs,

    // Time series modals
    [ModalType.Smoothing]: ModalCategory.TimeSeries,
    [ModalType.Decomposition]: ModalCategory.TimeSeries,
    [ModalType.Autocorrelation]: ModalCategory.TimeSeries,
    [ModalType.UnitRootTest]: ModalCategory.TimeSeries,
    [ModalType.BoxJenkinsModel]: ModalCategory.TimeSeries,
    [ModalType.ARDL]: ModalCategory.TimeSeries,
    [ModalType.ECM]: ModalCategory.TimeSeries,
    [ModalType.ARCH]: ModalCategory.TimeSeries,
    [ModalType.GARCH]: ModalCategory.TimeSeries,
    [ModalType.HomoscedasticityTest]: ModalCategory.TimeSeries,
    [ModalType.HeteroskedasticityModels]: ModalCategory.TimeSeries,

    // Descriptive statistics modals
    [ModalType.Descriptives]: ModalCategory.Analyze,
    [ModalType.Explore]: ModalCategory.Analyze,
    [ModalType.Frequencies]: ModalCategory.Analyze,
    [ModalType.Crosstabs]: ModalCategory.Analyze,
    [ModalType.Ratio]: ModalCategory.Analyze,
    [ModalType.PPPlots]: ModalCategory.Analyze,
    [ModalType.QQPlots]: ModalCategory.Analyze,

    // Compare Means modals
    [ModalType.IndependentSamplesTTest]: ModalCategory.Analyze,
    [ModalType.OneSampleTTest]: ModalCategory.Analyze,
    [ModalType.PairedSamplesTTest]: ModalCategory.Analyze,
    [ModalType.OneWayANOVA]: ModalCategory.Analyze,
    [ModalType.BartlettTest]: ModalCategory.Analyze,

    // Correlate modals
    [ModalType.Bivariate]: ModalCategory.Analyze,

    // General Linear Model modals
    [ModalType.ModalUnivariate]: ModalCategory.Analyze,
    [ModalType.ModalMultivariate]: ModalCategory.Analyze,
    [ModalType.ModalRepeatedMeasures]: ModalCategory.Analyze,
    [ModalType.ModalVarianceComponents]: ModalCategory.Analyze,

    // Classify modals
    [ModalType.ModalTwoStepCluster]: ModalCategory.Analyze,
    [ModalType.ModalKMeansCluster]: ModalCategory.Analyze,
    [ModalType.ModalKMedoidsCluster]: ModalCategory.Analyze,
    [ModalType.ModalHierarchicalCluster]: ModalCategory.Analyze,
    [ModalType.ModalClusterSilhouettes]: ModalCategory.Analyze,
    [ModalType.ModalTree]: ModalCategory.Analyze,
    [ModalType.ModalDiscriminant]: ModalCategory.Analyze,
    [ModalType.ModalNearestNeighbor]: ModalCategory.Analyze,
    [ModalType.ModalNaiveBayes]: ModalCategory.Analyze,
    [ModalType.ModalApplyModel]: ModalCategory.Analyze,
    [ModalType.ModalROCCurve]: ModalCategory.Analyze,
    [ModalType.ModalROCAnalysis]: ModalCategory.Analyze,

    // Dimension Reduction modals
    [ModalType.ModalFactor]: ModalCategory.Analyze,
    [ModalType.ModalCorrespondenceAnalysis]: ModalCategory.Analyze,
    [ModalType.ModalDROptimalScaling]: ModalCategory.Analyze,
    [ModalType.ModalOptimalScalingCATPCA]: ModalCategory.Analyze,
    [ModalType.ModalOptimalScalingOVERALS]: ModalCategory.Analyze,
    [ModalType.ModalOptimalScalingMCA]: ModalCategory.Analyze,

    // Nonparametric Tests modals
    [ModalType.ChiSquare]: ModalCategory.Analyze,
    [ModalType.Runs]: ModalCategory.Analyze,
    [ModalType.TwoIndependentSamples]: ModalCategory.Analyze,
    [ModalType.KIndependentSamples]: ModalCategory.Analyze,
    [ModalType.TwoRelatedSamples]: ModalCategory.Analyze,
    [ModalType.KRelatedSamples]: ModalCategory.Analyze,
};

/**
 * isModalInCategory - Memeriksa apakah modal termasuk dalam kategori tertentu
 *
 * @param type - Tipe modal yang diperiksa
 * @param category - Kategori yang dicek
 * @returns true jika modal ada dalam kategori tersebut
 */
export const isModalInCategory = (
    type: ModalType,
    category: ModalCategory
): boolean => MODAL_CATEGORIES[type] === category;

/**
 * isFileModal - Memeriksa apakah modal adalah tipe File
 *
 * @param type - Tipe modal yang diperiksa
 * @returns true jika modal adalah tipe File
 */
export const isFileModal = (type: ModalType): boolean =>
    isModalInCategory(type, ModalCategory.File);

/**
 * isDataModal - Memeriksa apakah modal adalah tipe Data
 *
 * @param type - Tipe modal yang diperiksa
 * @returns true jika modal adalah tipe Data
 */
export const isDataModal = (type: ModalType): boolean =>
    isModalInCategory(type, ModalCategory.Data);

/**
 * isEditModal - Memeriksa apakah modal adalah tipe Edit
 *
 * @param type - Tipe modal yang diperiksa
 * @returns true jika modal adalah tipe Edit
 */
export const isEditModal = (type: ModalType): boolean =>
    isModalInCategory(type, ModalCategory.Edit);

/**
 * getModalTitle - Mendapatkan judul yang sesuai untuk modal
 *
 * @param type - Tipe modal
 * @returns Judul yang sesuai untuk modal tersebut
 */
export function getModalTitle(type: ModalType): string {
    // Konversi dari enum ke format title case yang user-friendly
    const rawTitle = type
        .toString()
        .replace(/([A-Z])/g, " $1") // Add space before capital letters
        .replace(/^./, (str) => str.toUpperCase()); // Capitalize first letter

    // Handle special cases
    switch (type) {
        case ModalType.ImportCSV:
            return "Import CSV";
        case ModalType.ExportCSV:
            return "Export CSV";
        case ModalType.ImportExcel:
            return "Import Excel";
        case ModalType.ExportExcel:
            return "Export Excel";
        case ModalType.FindAndReplace:
            return "Find and Replace";
        case ModalType.GoTo:
            return "Go To";
        case ModalType.DefineVarProps:
            return "Define Variable Properties";
        case ModalType.VarPropsEditor:
            return "Variable Properties Editor";
        case ModalType.SortVars:
            return "Sort Variables";
        case ModalType.ChartBuilderModal:
            return "Chart Builder";
        case ModalType.SimpleBarModal:
            return "Bar Chart";
        case ModalType.ModalAutomaticLinearModeling:
            return "Automatic Linear Modeling";
        case ModalType.ModalLinear:
            return "Linear Regression";
        case ModalType.ModalCurveEstimation:
            return "Curve Estimation";
        case ModalType.ModalBinaryLogistic:
            return "Binary Logistic Regression";
        case ModalType.ModalBinaryLogisticExperiment:
            return "Binary Logistic (Experiment)";
        case ModalType.ModalMultinomialLogistic:
            return "Multinomial Logistic Regression";
        case ModalType.ModalOrdinal:
            return "Ordinal Regression";
        case ModalType.ModalProbit:
            return "Probit Analysis";
        case ModalType.ModalNonlinear:
            return "Nonlinear Regression";
        case ModalType.ModalWeightEstimation:
            return "Weight Estimation";
        case ModalType.ModalTwoStageLeastSquares:
            return "Two-Stage Least Squares";
        case ModalType.ModalPartialLeastSquares:
            return "Partial Least Squares";
        case ModalType.ModalQuantiles:
            return "Quantile Regression";
        case ModalType.ModalOptimalScaling:
            return "Optimal Scaling";
        case ModalType.SetMeasurementLevel:
            return "Set Measurement Level";
        case ModalType.DefineDateTime:
            return "Define Date and Time";
        case ModalType.DuplicateCases:
            return "Identify Duplicate Cases";
        case ModalType.UnusualCases:
            return "Identify Unusual Cases";
        case ModalType.Restructure:
            return "Restructure Data";
        case ModalType.Aggregate:
            return "Aggregate Data";
        case ModalType.MergeFiles:
            return "Merge Files";
        case ModalType.SplitFile:
            return "Split File";
        case ModalType.WeightCases:
            return "Weight Cases";
        case ModalType.MultipleResponse:
            return "Multiple Response Sets";
        case ModalType.NewCustomAttr:
            return "New Custom Attribute";
        case ModalType.SelectCases:
            return "Select Cases";
        case ModalType.ExampleDataset:
            return "Example Dataset";
        case ModalType.GoToCase:
            return "Go To Case";
        case ModalType.GoToVariable:
            return "Go To Variable";
        case ModalType.OneSampleTTest:
            return "One-Sample T Test";
        case ModalType.IndependentSamplesTTest:
            return "Independent-Samples T Test";
        case ModalType.PairedSamplesTTest:
            return "Paired-Samples T Test";
        case ModalType.OneWayANOVA:
            return "One-Way ANOVA";
        case ModalType.Bivariate:
            return "Bivariate Correlations";
        case ModalType.ChiSquare:
            return "Chi-square Test";
        case ModalType.Runs:
            return "Runs Test";
        case ModalType.TwoIndependentSamples:
            return "Two Independent Samples Tests";
        case ModalType.KIndependentSamples:
            return "K Independent Samples Tests";
        case ModalType.TwoRelatedSamples:
            return "Two Related Samples Tests";
        case ModalType.KRelatedSamples:
            return "K Related Samples Tests";

        // Time Series
        case ModalType.HomoscedasticityTest:
            return "Homoscedasticity Test (ARCH-LM)";
        case ModalType.HeteroskedasticityModels:
            return "Heteroskedasticity Models";

        // General Linear Model modals
        case ModalType.ModalUnivariate:
            return "Univariate Analysis";
        case ModalType.ModalMultivariate:
            return "Multivariate Analysis";
        case ModalType.ModalRepeatedMeasures:
            return "Repeated Measures";
        case ModalType.ModalVarianceComponents:
            return "Variance Components";

        // Classify modals
        case ModalType.ModalTwoStepCluster:
            return "Two-Step Cluster";
        case ModalType.ModalKMeansCluster:
            return "K-Means Cluster";
        case ModalType.ModalKMedoidsCluster:
            return "K-Medoids Cluster";
        case ModalType.ModalHierarchicalCluster:
            return "Hierarchical Cluster";
        case ModalType.ModalClusterSilhouettes:
            return "Cluster Silhouettes";
        case ModalType.ModalTree:
            return "Decision Tree";
        case ModalType.ModalDiscriminant:
            return "Discriminant Analysis";
        case ModalType.ModalNearestNeighbor:
            return "Nearest Neighbor";
        case ModalType.ModalNaiveBayes:
            return "Naive Bayes";
        case ModalType.ModalApplyModel:
            return "Apply Model";
        case ModalType.ModalROCCurve:
            return "ROC Curve";
        case ModalType.ModalROCAnalysis:
            return "ROC Analysis";

        // Dimension Reduction modals
        case ModalType.ModalFactor:
            return "Factor Analysis";
        case ModalType.ModalCorrespondenceAnalysis:
            return "Correspondence Analysis";
        case ModalType.ModalDROptimalScaling:
            return "Optimal Scaling";
        case ModalType.ModalOptimalScalingCATPCA:
            return "Optimal Scaling (CATPCA)";
        case ModalType.ModalOptimalScalingOVERALS:
            return "Optimal Scaling (OVERALS)";
        case ModalType.ModalOptimalScalingMCA:
            return "Optimal Scaling (MCA)";

        default:
            return rawTitle.trim();
    }
}
