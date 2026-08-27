import * as Crypto from 'expo-crypto';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { File as ExpoFile } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { createElement, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, SectionHeading, StatePanel } from '@/components/ui';
import { getAccountState } from '@/lib/auth';
import {
  analyzeMealPhoto,
  cacheFoodCatalogItems,
  classifyMealPhotoAnalysisError,
  consumeQueuedMealPhotoResult,
  getMealPhotoAnalysisCapability,
  getMealDetail,
  getQueuedMealPhotoResult,
  lookupFoodBarcode,
  markFoodCatalogItemUsed,
  queueMealPhotoAnalysis,
  saveMeal,
  savePrivateFood,
  searchFoodDatabase,
  searchLocalFoodCatalog,
  type FoodCatalogItem,
  type MealType,
} from '@/lib/db';
import { reconcileMealGapNotification } from '@/lib/notifications';
import {
  convertServingQuantity,
  scaleServingMacros,
  servingScale,
  servingUnitOptions,
  type ServingMacros,
} from '@/lib/nutrition/serving';
import { radii, spacing, typography, useJienTheme } from '@/theme';
import { formatShortDate, localTimestampForDate, toLocalDateKey } from '@/lib/time';
import { MAX_WEB_MEAL_PHOTO_BASE64_LENGTH, resolveMealPhotoPickerResult } from '@/lib/media/image-picker';
import {
  applyPhotoAnalysisDrafts,
  initialMealPhotoFlowState,
  reduceMealPhotoFlow,
  serializeMealPhotoProvenance,
  type PendingMealPhoto,
} from '@/lib/meal-photo-flow';
import {
  mealDraftContext,
  mealDraftHasContent,
  mealDraftStorageKey,
  parseMealDraft,
  isBlankMealDraftFood,
  summarizeMealDraft,
  type MealDraftFood,
} from '@/lib/meal-draft';
import { buildRepeatMealDraft } from '@/lib/nutrition/meal-template';

type DraftFood = MealDraftFood;

type CameraMode = 'barcode' | 'photo' | null;
const emptyFood = (): DraftFood => ({
  key: Crypto.randomUUID(), catalogId: null, name: '', quantity: '1', unit: 'serving',
  calories: '', protein: '', carbs: '', fat: '', fibre: '', source: 'manual', sourceLabel: null, confidence: null,
  referenceQuantity: 1,
  referenceUnit: 'serving',
  referenceMacros: { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0, fibreG: 0 },
});
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

export default function NewMealScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { date, photoJob, templateMealId } = useLocalSearchParams<{ date?: string; photoJob?: string; templateMealId?: string }>();
  const { colors } = useJienTheme();
  const cameraRef = useRef<CameraView>(null);
  const screenRef = useRef<ScrollView>(null);
  const mealItemsYRef = useRef(0);
  const photoAnalysisLockRef = useRef(false);
  const photoQueueLockRef = useRef(false);
  const submitLockRef = useRef(false);
  const draftClearedRef = useRef(false);
  const queuedPhotoRecoveryRef = useRef<string | null>(null);
  const templateMealLoadRef = useRef<string | null>(null);
  const barcodeLockRef = useRef(false);
  const pendingPickerResultRef = useRef<ReturnType<typeof ImagePicker.getPendingResultAsync> | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const now = new Date();
  const inferred: MealType = now.getHours() < 11 ? 'breakfast' : now.getHours() < 15 ? 'lunch' : now.getHours() < 19 ? 'dinner' : 'snack';
  const initialMealTypeRef = useRef(inferred);
  const todayKeyRef = useRef(toLocalDateKey(now));
  const [name, setName] = useState('Meal');
  const [type, setType] = useState<MealType>(inferred);
  const [foods, setFoods] = useState<DraftFood[]>([emptyFood()]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodCatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [noMatchQuery, setNoMatchQuery] = useState<string | null>(null);
  const [savingPrivateFoodKey, setSavingPrivateFoodKey] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [barcodeCaptured, setBarcodeCaptured] = useState(false);
  const [barcodeStatus, setBarcodeStatus] = useState<string | null>(null);
  const [photoFlow, dispatchPhoto] = useReducer(reduceMealPhotoFlow, initialMealPhotoFlowState);
  const [appliedPhotoRequestIds, setAppliedPhotoRequestIds] = useState<string[]>([]);
  const [photoAnalyses, setPhotoAnalyses] = useState<Array<{
    requestId: string;
    description: string;
    itemKeys: string[];
  }>>([]);
  const [barcodeValue, setBarcodeValue] = useState('');
  const [toolMessage, setToolMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftOwnerUserId, setDraftOwnerUserId] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(process.env.EXPO_OS !== 'web');
  const [draftRecovered, setDraftRecovered] = useState(false);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateLoading, setTemplateLoading] = useState(Boolean(templateMealId));
  const photoAccessStatus = photoFlow.failure?.status ?? photoFlow.capability?.status ?? null;
  const photoReference = photoFlow.failure?.requestId ?? photoFlow.capability?.requestId ?? null;
  const photoCanAnalyze = photoFlow.phase === 'failed'
    ? photoFlow.failure?.retryable === true
    : photoFlow.capability?.available === true;
  const draftContext = useMemo(
    () => mealDraftContext(date ?? todayKeyRef.current, photoJob, templateMealId),
    [date, photoJob, templateMealId],
  );
  const draftSummary = useMemo(() => summarizeMealDraft(foods), [foods]);

  useEffect(() => {
    if (process.env.EXPO_OS !== 'web') return;
    void getAccountState().then((account) => {
      const ownerUserId = account.configured ? account.user?.id ?? null : null;
      setDraftOwnerUserId(ownerUserId);
      if (!ownerUserId) setDraftReady(true);
    });
  }, []);

  useEffect(() => {
    if (process.env.EXPO_OS !== 'web' || !draftOwnerUserId || draftReady) return;
    let recovered = null;
    try {
      recovered = parseMealDraft(
        globalThis.localStorage?.getItem(mealDraftStorageKey(draftOwnerUserId, draftContext)) ?? '',
        draftOwnerUserId,
        draftContext,
      );
    } catch {
      setDraftWarning('This browser blocked meal-draft recovery. You can still log and save normally.');
    }
    if (recovered) {
      setName(recovered.name);
      setType(recovered.type);
      setFoods(recovered.foods);
      setAppliedPhotoRequestIds(recovered.appliedPhotoRequestIds);
      setPhotoAnalyses(recovered.photoAnalyses);
      setDraftRecovered(true);
      setTemplateLoading(false);
    }
    setDraftReady(true);
  }, [draftContext, draftOwnerUserId, draftReady]);

  useEffect(() => {
    if (!draftReady || draftRecovered || !templateMealId || templateMealLoadRef.current === templateMealId) return;
    templateMealLoadRef.current = templateMealId;
    let active = true;
    void getMealDetail(db, templateMealId).then((detail) => {
      if (!active) return;
      if (!detail || detail.items.length === 0) {
        setTemplateError('That saved meal is no longer available. You can still build this meal manually.');
        return;
      }
      const repeated = buildRepeatMealDraft(detail, initialMealTypeRef.current, Crypto.randomUUID);
      setName(repeated.name);
      setType(repeated.type);
      setFoods(repeated.foods);
      setAppliedPhotoRequestIds([]);
      setPhotoAnalyses([]);
      setTemplateLoaded(true);
    }).catch((cause) => {
      if (active) setTemplateError(cause instanceof Error ? cause.message : 'The saved meal could not be copied.');
    }).finally(() => {
      if (active) setTemplateLoading(false);
    });
    return () => { active = false; };
  }, [db, draftReady, draftRecovered, templateMealId]);

  useEffect(() => {
    if (process.env.EXPO_OS !== 'web' || !draftReady || !draftOwnerUserId) return;
    const storageKey = mealDraftStorageKey(draftOwnerUserId, draftContext);
    const snapshot = {
      version: 1 as const,
      ownerUserId: draftOwnerUserId,
      context: draftContext,
      name,
      type,
      foods,
      appliedPhotoRequestIds,
      photoAnalyses,
      updatedAt: new Date().toISOString(),
    };
    const timer = setTimeout(() => {
      if (draftClearedRef.current) return;
      try {
        if (mealDraftHasContent(snapshot, initialMealTypeRef.current)) {
          globalThis.localStorage?.setItem(storageKey, JSON.stringify(snapshot));
        } else {
          globalThis.localStorage?.removeItem(storageKey);
        }
        setDraftWarning(null);
      } catch {
        setDraftWarning('This browser could not store a recovery copy. Save this meal before leaving the page.');
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [appliedPhotoRequestIds, draftContext, draftOwnerUserId, draftReady, foods, name, photoAnalyses, type]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void searchLocalFoodCatalog(db, query).then(setResults).catch((cause) => {
        setToolMessage(cause instanceof Error ? cause.message : 'Could not search saved foods.');
      });
    }, 160);
    return () => clearTimeout(timer);
  }, [db, query]);

  useFocusEffect(useCallback(() => {
    if (!photoFlow.selection) return;
    let active = true;
    void getMealPhotoAnalysisCapability().then((capability) => {
      if (active) dispatchPhoto({ type: 'capability_resolved', capability });
    });
    return () => { active = false; };
  }, [photoFlow.selection]));

  useEffect(() => {
    if (!draftReady || !photoJob || queuedPhotoRecoveryRef.current === photoJob) return;
    queuedPhotoRecoveryRef.current = photoJob;
    let active = true;
    void getQueuedMealPhotoResult(db, photoJob).then(async (result) => {
      if (!active) return;
      if (!result) {
        setToolMessage('That queued photo result is no longer available.');
        return;
      }
      if (appliedPhotoRequestIds.includes(result.requestId)) {
        await consumeQueuedMealPhotoResult(db, result.id);
        return;
      }
      const drafts = result.items.map(toDraftFood);
      const itemKeys = drafts.map((item) => item.key);
      setFoods((current) => current.length === 1 && isBlankFood(current[0]!)
        ? drafts
        : [...current, ...drafts]);
      setAppliedPhotoRequestIds((current) => current.includes(result.requestId)
        ? current
        : [...current, result.requestId]);
      setPhotoAnalyses((current) => current.some((item) => item.requestId === result.requestId)
        ? current
        : [...current, { requestId: result.requestId, description: result.description, itemKeys }]);
      setToolMessage(`${itemKeys.length} queued AI-estimated item${itemKeys.length === 1 ? '' : 's'} added. Review every portion and macro before saving.`);
      await consumeQueuedMealPhotoResult(db, result.id);
    }).catch((cause) => {
      if (active) setToolMessage(cause instanceof Error ? cause.message : 'The queued photo result could not be opened.');
    });
    return () => { active = false; };
  }, [appliedPhotoRequestIds, db, draftReady, photoJob]);

  const update = (key: string, field: 'name', value: string) => {
    setFormError(null);
    setFoods((current) => current.map((food) => food.key === key ? { ...food, [field]: value } : food));
  };

  const updateQuantity = (key: string, value: string) => {
    setFormError(null);
    setFoods((current) => current.map((food) => {
      if (food.key !== key) return food;
      const scale = servingScale(Number(value), food.unit, food.referenceQuantity, food.referenceUnit);
      if (scale == null) return { ...food, quantity: value };
      return { ...food, quantity: value, ...macroStrings(scaleServingMacros(food.referenceMacros, scale)) };
    }));
  };

  const updateUnit = (key: string, value: string) => {
    setFormError(null);
    setFoods((current) => current.map((food) => {
      if (food.key !== key || food.unit === value) return food;
      const currentQuantity = Number(food.quantity);
      const converted = convertServingQuantity(currentQuantity, food.unit, value);
      if (converted != null) {
        return { ...food, unit: value, quantity: formatFoodNumber(converted) };
      }
      return {
        ...food,
        unit: value,
        referenceQuantity: Number.isFinite(currentQuantity) && currentQuantity > 0 ? currentQuantity : 1,
        referenceUnit: value,
        referenceMacros: currentMacros(food),
      };
    }));
  };

  const updateMacro = (key: string, field: 'calories' | 'protein' | 'carbs' | 'fat' | 'fibre', value: string) => {
    setFormError(null);
    setFoods((current) => current.map((food) => {
      if (food.key !== key) return food;
      const next = { ...food, [field]: value };
      const numeric = Number(value);
      const scale = servingScale(Number(food.quantity), food.unit, food.referenceQuantity, food.referenceUnit);
      if (!Number.isFinite(numeric) || scale == null || scale <= 0) return next;
      const referenceKey = macroReferenceKey(field);
      return {
        ...next,
        referenceMacros: { ...food.referenceMacros, [referenceKey]: numeric / scale },
      };
    }));
  };

  const addCatalogFood = async (item: FoodCatalogItem) => {
    const draft = toDraftFood(item);
    setFoods((current) => current.length === 1 && isBlankFood(current[0]!) ? [draft] : [...current, draft]);
    setQuery('');
    setResults([]);
    setToolMessage(`${item.name} added. Adjust the portion or macros if needed.`);
    if (item.source !== 'ai_photo') {
      try {
        await markFoodCatalogItemUsed(db, item.id);
      } catch {
        // Usage ranking is best-effort and must never undo an item already added to the meal.
      }
    }
  };

  const runDatabaseSearch = async () => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
      setToolMessage('Enter at least two characters to search the online database.');
      return;
    }
    setSearching(true);
    setToolMessage(null);
    try {
      const items = await searchFoodDatabase(cleanQuery);
      setResults(items);
      setNoMatchQuery(items.length ? null : cleanQuery);
      setToolMessage(items.length
        ? `Found ${items.length} online ${items.length === 1 ? 'match' : 'matches'} from ${onlineFoodSourceSummary(items)}.`
        : 'No database matches found.');
      try {
        await cacheFoodCatalogItems(db, items);
      } catch {
        // Search results remain usable if the optional local cache write fails.
      }
    } catch (cause) {
      setNoMatchQuery(cleanQuery);
      const message = cause instanceof Error ? cause.message : 'Online food search is unavailable.';
      setToolMessage(`${message} You can still create a private food below.`);
    } finally {
      setSearching(false);
    }
  };

  const beginPrivateFood = () => {
    const seedName = (noMatchQuery ?? query).trim();
    const nextFood = { ...emptyFood(), name: seedName };
    setFoods((current) => {
      const blankIndex = current.findIndex(isBlankFood);
      if (blankIndex < 0) return [...current, nextFood];
      return current.map((food, index) => index === blankIndex ? nextFood : food);
    });
    setQuery('');
    setResults([]);
    setNoMatchQuery(null);
    setToolMessage('Add the serving and label values below, then save it to your private foods for one-tap reuse.');
    setTimeout(() => {
      screenRef.current?.scrollTo({ y: Math.max(0, mealItemsYRef.current - spacing.md), animated: true });
    }, 80);
  };

  const saveFoodForReuse = async (food: DraftFood) => {
    if (savingPrivateFoodKey) return;
    setSavingPrivateFoodKey(food.key);
    setFormError(null);
    try {
      const item = await savePrivateFood(db, {
        id: food.catalogId,
        name: food.name,
        servingQuantity: Number(food.quantity),
        servingUnit: food.unit,
        caloriesKcal: Number(food.calories),
        proteinG: Number(food.protein),
        carbohydrateG: Number(food.carbs),
        fatG: Number(food.fat),
        fibreG: food.fibre.trim() ? Number(food.fibre) : null,
      });
      setFoods((current) => current.map((draft) => draft.key === food.key ? {
        ...draft,
        catalogId: item.id,
        name: item.name,
        quantity: String(item.servingQuantity),
        unit: item.servingUnit,
        source: draft.source,
        sourceLabel: food.catalogId?.startsWith('custom-') || !food.sourceLabel
          ? 'Private food'
          : `Private food · ${food.sourceLabel}`,
        confidence: draft.source === 'ai_photo' ? draft.confidence : null,
        referenceQuantity: item.servingQuantity,
        referenceUnit: item.servingUnit,
        referenceMacros: {
          caloriesKcal: item.caloriesKcal,
          proteinG: item.proteinG,
          carbohydrateG: item.carbohydrateG,
          fatG: item.fatG,
          fibreG: item.fibreG ?? 0,
        },
      } : draft));
      setToolMessage(`${item.name} ${food.catalogId?.startsWith('custom-') ? 'updated' : 'saved'} in your private foods on this device.`);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'This private food could not be saved.');
    } finally {
      setSavingPrivateFoodKey(null);
    }
  };

  const openCamera = async (mode: Exclude<CameraMode, null>) => {
    setToolMessage(null);
    setBarcodeCaptured(false);
    setBarcodeStatus(null);
    setCameraReady(false);
    let granted = cameraPermission?.granted ?? false;
    if (!granted) granted = (await requestCameraPermission()).granted;
    if (!granted) {
      setToolMessage('Camera permission is needed for photos and barcode scanning.');
      return;
    }
    setCameraMode(mode);
  };

  const closeCamera = () => {
    barcodeLockRef.current = false;
    setCameraReady(false);
    setBarcodeCaptured(false);
    setBarcodeStatus(null);
    setCameraMode(null);
  };

  const handleBarcode = async ({ data }: BarcodeScanningResult) => {
    if (cameraBusy || barcodeLockRef.current) return;
    barcodeLockRef.current = true;
    setBarcodeCaptured(true);
    setBarcodeValue(data);
    setBarcodeStatus('Barcode found. Looking up the food…');
    try {
      const matched = await lookupBarcode(data, true);
      if (matched) closeCamera();
    } finally {
      // Keep scanning locked after a failed lookup until the user explicitly retries or scans another code.
    }
  };

  const retryScannedBarcode = async () => {
    if (!barcodeValue || cameraBusy) return;
    barcodeLockRef.current = true;
    setBarcodeStatus('Trying that barcode again…');
    const matched = await lookupBarcode(barcodeValue, true);
    if (matched) closeCamera();
  };

  const scanAnotherBarcode = () => {
    barcodeLockRef.current = false;
    setBarcodeCaptured(false);
    setBarcodeStatus(null);
    setBarcodeValue('');
  };

  const lookupBarcode = async (value = barcodeValue, fromCamera = false): Promise<boolean> => {
    if (cameraBusy) return false;
    setCameraBusy(true);
    if (!fromCamera) setToolMessage(null);
    try {
      const items = await lookupFoodBarcode(value);
      if (!items[0]) throw new Error('No food matched that barcode. Try another angle or enter it manually.');
      await addCatalogFood(items[0]);
      try {
        await cacheFoodCatalogItems(db, items);
      } catch {
        // The matched product is already in the draft; caching is only an optimization.
      }
      setBarcodeValue('');
      setToolMessage(`${items[0].name} added from Open Food Facts. Review the serving and macros.`);
      setBarcodeStatus(`${items[0].name} added.`);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not look up that barcode.';
      setToolMessage(message);
      if (fromCamera) setBarcodeStatus(message);
      return false;
    } finally {
      setCameraBusy(false);
    }
  };

  const preparePhoto = async (uri: string, sourceLabel: string, width?: number) => {
    const context = ImageManipulator.manipulate(uri);
    if (width != null && width > 1280) context.resize({ width: 1280, height: null });
    const rendered = await context.renderAsync();
    const resized = await rendered.saveAsync({ compress: 0.68, format: SaveFormat.JPEG, base64: true });
    if (!resized.base64) throw new Error('The meal photo could not be prepared for analysis.');
    try {
      dispatchPhoto({
        type: 'selected',
        selection: { base64: resized.base64, mediaType: 'image/jpeg', sourceLabel },
      });
    } finally {
      try {
        new ExpoFile(resized.uri).delete();
      } catch {
        // Cache cleanup is best-effort and must not hide the analysis result.
      }
    }
  };

  const analyzePhoto = async () => {
    if (!cameraRef.current || cameraBusy) return;
    setCameraBusy(true);
    setToolMessage('Capturing the visible meal…');
    try {
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!picture?.uri) throw new Error('The camera did not return an image.');
      await preparePhoto(picture.uri, 'Camera photo', picture.width);
      closeCamera();
      setToolMessage(null);
    } catch (cause) {
      setToolMessage(cause instanceof Error ? cause.message : 'The meal photo could not be prepared.');
    } finally {
      setCameraBusy(false);
    }
  };

  const chooseNativePhoto = async () => {
    if (Platform.OS === 'web' || cameraBusy) return;
    setCameraBusy(true);
    setToolMessage('Opening your photo library…');
    try {
      if (Platform.OS === 'ios') {
        const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
        const permission = existing.granted ? existing : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          throw new Error(permission.canAskAgain
            ? 'Photo library permission is needed to choose a meal photo.'
            : 'Photo library access is blocked. Enable Photos access for JIEN in device settings.');
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: false,
        selectionLimit: 1,
        quality: 1,
        base64: false,
        shouldDownloadFromNetwork: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const resolution = resolveMealPhotoPickerResult(result);
      if (resolution.kind === 'canceled' || resolution.kind === 'empty') {
        setToolMessage(null);
        return;
      }
      if (resolution.kind === 'error') throw new Error(resolution.message);
      setToolMessage('Preparing the selected meal photo…');
      await preparePhoto(resolution.asset.uri, 'Photo library', resolution.asset.width);
      setToolMessage(null);
    } catch (cause) {
      setToolMessage(cause instanceof Error ? cause.message : 'The selected meal photo could not be analyzed.');
    } finally {
      setCameraBusy(false);
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    pendingPickerResultRef.current ??= ImagePicker.getPendingResultAsync();
    let active = true;
    void pendingPickerResultRef.current.then(async (result) => {
      if (!active) return;
      const resolution = resolveMealPhotoPickerResult(result);
      if (resolution.kind === 'empty' || resolution.kind === 'canceled') return;
      if (resolution.kind === 'error') {
        setToolMessage(resolution.message);
        return;
      }
      setCameraBusy(true);
      setToolMessage('Resuming your selected meal photo…');
      try {
        await preparePhoto(resolution.asset.uri, 'Photo library', resolution.asset.width);
        if (active) setToolMessage(null);
      } catch (cause) {
        if (active) setToolMessage(cause instanceof Error ? cause.message : 'The selected meal photo could not be analyzed.');
      } finally {
        if (active) setCameraBusy(false);
      }
    }).catch((cause) => {
      if (active) setToolMessage(cause instanceof Error ? cause.message : 'The photo picker could not recover its last result.');
    });
    return () => { active = false; };
  }, []);

  const handleWebPhoto = async (event: { target: { files?: FileList | null; value?: string } }) => {
    const file = event.target.files?.[0];
    if (!file || cameraBusy) return;
    setCameraBusy(true);
    setToolMessage('Preparing the selected photo...');
    try {
      const prepared = await prepareWebPhoto(file);
      dispatchPhoto({ type: 'selected', selection: prepared });
      setToolMessage(null);
    } catch (cause) {
      setToolMessage(cause instanceof Error ? cause.message : 'The meal photo could not be analyzed.');
    } finally {
      if (event.target) event.target.value = '';
      setCameraBusy(false);
    }
  };

  const analyzePendingPhoto = async () => {
    const selection = photoFlow.selection;
    if (!selection || cameraBusy || photoAnalysisLockRef.current || !photoFlow.capability?.available) return;
    photoAnalysisLockRef.current = true;
    setCameraBusy(true);
    dispatchPhoto({ type: 'analysis_started' });
    try {
      const context = photoFlow.description.trim();
      const analysis = await analyzeMealPhoto(selection.base64, context, selection.mediaType);
      const drafts = analysis.items.map(toDraftFood);
      const merged = applyPhotoAnalysisDrafts(
        foods,
        drafts,
        analysis.requestId,
        appliedPhotoRequestIds,
        isBlankFood,
      );
      setFoods(merged.items);
      setAppliedPhotoRequestIds(merged.appliedRequestIds);
      if (merged.insertedItems.length) {
        const itemKeys = merged.insertedItems.map((item) => item.key);
        setPhotoAnalyses((current) => current.some((item) => item.requestId === analysis.requestId)
          ? current
          : [...current, { requestId: analysis.requestId, description: context, itemKeys }]);
        dispatchPhoto({ type: 'analysis_succeeded', requestId: analysis.requestId, itemKeys });
        setToolMessage(`${itemKeys.length} AI-estimated item${itemKeys.length === 1 ? '' : 's'} added to this meal draft.`);
      } else {
        dispatchPhoto({
          type: 'analysis_succeeded',
          requestId: analysis.requestId,
          itemKeys: photoFlow.result?.itemKeys ?? [],
        });
      }
    } catch (cause) {
      dispatchPhoto({ type: 'analysis_failed', failure: classifyMealPhotoAnalysisError(cause) });
    } finally {
      photoAnalysisLockRef.current = false;
      setCameraBusy(false);
    }
  };

  const queuePendingPhoto = async () => {
    const selection = photoFlow.selection;
    if (!selection || cameraBusy || photoQueueLockRef.current) return;
    photoQueueLockRef.current = true;
    setCameraBusy(true);
    try {
      await queueMealPhotoAnalysis(db, {
        base64: selection.base64,
        mediaType: selection.mediaType,
        sourceLabel: selection.sourceLabel,
        description: photoFlow.description,
      });
      dispatchPhoto({ type: 'dismissed' });
      setToolMessage('Photo saved on this device. Analysis will resume when your signed-in connection is available; the result will appear on Food.');
    } catch (cause) {
      setToolMessage(cause instanceof Error ? cause.message : 'The photo could not be queued on this device.');
    } finally {
      photoQueueLockRef.current = false;
      setCameraBusy(false);
    }
  };

  const dismissPendingPhoto = (manual = false) => {
    if (cameraBusy) return;
    const description = photoFlow.description.trim();
    if (manual && description) {
      setFoods((current) => current.length === 1 && isBlankFood(current[0]!)
        ? [{ ...current[0]!, name: description }]
        : [...current, { ...emptyFood(), name: description }]);
    }
    dispatchPhoto({ type: 'dismissed' });
    if (manual) setToolMessage(description
      ? 'Photo analysis skipped. The description is in a new food item; add its portion and macros below.'
      : 'Photo analysis skipped. Enter the food and macros manually below.');
  };

  const refreshPhotoCapability = async () => {
    if (!photoFlow.selection || cameraBusy) return;
    dispatchPhoto({ type: 'capability_checking' });
    const capability = await getMealPhotoAnalysisCapability();
    dispatchPhoto({ type: 'capability_resolved', capability });
  };

  const reviewAnalyzedItems = () => {
    dispatchPhoto({ type: 'dismissed' });
    setTimeout(() => {
      screenRef.current?.scrollTo({ y: Math.max(0, mealItemsYRef.current - spacing.md), animated: true });
    }, 80);
  };

  const submit = async () => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      if (!draftSummary.completedFoodCount && !draftSummary.needsAttentionCount) {
        throw new Error('Add at least one food before saving.');
      }
      if (draftSummary.needsAttentionCount) {
        throw new Error('Enter a food name, positive portion, and valid non-negative calories and macros for every started row.');
      }
      const completedFoods = foods.filter((food) => !isBlankFood(food));
      const items = completedFoods.map((food) => ({
        name: food.name,
        quantity: Number(food.quantity),
        unit: food.unit,
        caloriesKcal: Number(food.calories),
        proteinG: Number(food.protein),
        carbohydrateG: Number(food.carbs),
        fatG: Number(food.fat),
        fibreG: food.fibre.trim() ? Number(food.fibre) : null,
        source: food.source,
        confidence: food.confidence,
      }));
      if (!items.length) throw new Error('Add at least one food before saving.');
      if (items.some((item) => [item.quantity, item.caloriesKcal, item.proteinG, item.carbohydrateG, item.fatG, item.fibreG ?? 0].some((value) => !Number.isFinite(value)))) {
        throw new Error('Enter a valid portion and macro estimate for every food.');
      }
      const eatenAt = date ? localTimestampForDate(date) : new Date().toISOString();
      const activeAiItemKeys = completedFoods
        .filter((food) => food.source === 'ai_photo')
        .map((food) => food.key);
      const aiContext = serializeMealPhotoProvenance(photoAnalyses, activeAiItemKeys);
      await saveMeal(db, { name, type, eatenAt, aiContext, items });
      draftClearedRef.current = true;
      if (process.env.EXPO_OS === 'web' && draftOwnerUserId) {
        try {
          globalThis.localStorage?.removeItem(mealDraftStorageKey(draftOwnerUserId, draftContext));
        } catch {
          // The durable meal is committed; browser recovery cleanup is best-effort.
        }
      }
      void reconcileMealGapNotification(db).catch(() => {
        // A reminder failure must never turn a committed meal into a retry that creates a duplicate.
      });
      if (templateMealId) router.replace('/food');
      else router.back();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Please check the meal and try again.');
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  };

  if (templateMealId && templateLoading && !draftRecovered) {
    return <Screen><StatePanel title="Copying saved meal" body="Loading its editable portions and macros from this device." loading /></Screen>;
  }

  return (
    <Screen scrollViewRef={screenRef} contentContainerStyle={styles.screenContent}>
      {date ? <Card style={{ backgroundColor: colors.surfaceMuted }}><AppText>Logging for <AppText style={{ fontWeight: '800' }}>{formatShortDate(`${date}T12:00:00`)}</AppText></AppText></Card> : null}
      {draftRecovered ? <View accessibilityLiveRegion="polite" style={[styles.message, { backgroundColor: colors.successSoft }]}><AppText>Your unfinished meal was restored. The draft remains available until you save it.</AppText></View> : null}
      {templateLoaded && !draftRecovered ? <View accessibilityLiveRegion="polite" style={[styles.message, { backgroundColor: colors.successSoft }]}><AppText>Saved meal copied. Adjust any portion or macro, then save it as a new log.</AppText></View> : null}
      {templateError ? <View accessibilityRole="alert" style={[styles.message, { backgroundColor: colors.warningSoft }]}><AppText style={{ color: colors.warning }}>{templateError}</AppText></View> : null}
      {draftWarning ? <View accessibilityRole="alert" style={[styles.message, { backgroundColor: colors.warningSoft }]}><AppText style={{ color: colors.warning }}>{draftWarning}</AppText></View> : null}
      <Field label="Meal name" value={name} onChangeText={setName} placeholder="Dinner" />
      <View style={styles.typeWrap}>{MEAL_TYPES.map((mealType) => <Pill key={mealType} label={mealType[0]!.toUpperCase() + mealType.slice(1)} active={type === mealType} onPress={() => setType(mealType)} />)}</View>

      <Card style={styles.discoveryCard}>
        <View style={styles.discoveryHeader}><View style={styles.flex}><AppText style={styles.sectionTitle}>Find food quickly</AppText><AppText style={{ color: colors.textMuted }}>Search local foods instantly, expand online, or use a meal or nutrition-label photo.</AppText></View></View>
        <Field label="Food search" value={query} onChangeText={(value) => { setQuery(value); setNoMatchQuery(null); }} placeholder="Try chicken, rice, yogurt…" returnKeyType="search" onSubmitEditing={() => void runDatabaseSearch()} />
        <View style={styles.toolActions}>
          <Button label="Search food database" onPress={() => void runDatabaseSearch()} busy={searching} variant="secondary" />
          <Button label="Scan barcode" onPress={() => void openCamera('barcode')} variant="secondary" />
          {Platform.OS === 'web' ? (
            <>
              <View style={[styles.webPhotoButton, { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }]}>
                <AppText style={[styles.webPhotoLabel, { color: colors.accent }]}>{cameraBusy ? 'Preparing photo...' : 'Take photo'}</AppText>
                {createElement('input', {
                  'aria-label': 'Take a meal photo',
                  accept: 'image/jpeg,image/png,image/webp',
                  capture: 'environment',
                  disabled: cameraBusy,
                  onChange: handleWebPhoto,
                  style: { cursor: 'pointer', inset: 0, opacity: 0, position: 'absolute', width: '100%' },
                  type: 'file',
                })}
              </View>
              <View style={[styles.webPhotoButton, { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }]}>
                <AppText style={[styles.webPhotoLabel, { color: colors.accent }]}>{cameraBusy ? 'Preparing photo...' : 'Choose photo'}</AppText>
                {createElement('input', {
                  'aria-label': 'Choose a meal photo from this device',
                  accept: 'image/jpeg,image/png,image/webp',
                  disabled: cameraBusy,
                  onChange: handleWebPhoto,
                  style: { cursor: 'pointer', inset: 0, opacity: 0, position: 'absolute', width: '100%' },
                  type: 'file',
                })}
              </View>
            </>
          ) : (
            <>
              <Button label="Take photo" onPress={() => void openCamera('photo')} disabled={cameraBusy} variant="secondary" />
              <Button label="Choose photo" onPress={() => void chooseNativePhoto()} busy={cameraBusy} variant="secondary" />
            </>
          )}
        </View>
        <View style={styles.barcodeRow}>
          <Field label="Barcode number" value={barcodeValue} onChangeText={setBarcodeValue} placeholder="Enter if camera scanning is unavailable" keyboardType="number-pad" returnKeyType="search" onSubmitEditing={() => void lookupBarcode()} containerStyle={styles.flex} />
          <Button label="Look up barcode" onPress={() => void lookupBarcode()} busy={cameraBusy} variant="secondary" />
        </View>

        {results.length ? (
          <View style={styles.results}>
            <View style={styles.resultHeading}>
              <AppText style={styles.resultHeadingTitle}>{query.trim() ? 'Matching foods' : 'Recent & common'}</AppText>
              <AppText style={{ color: colors.textMuted }}>{query.trim() ? 'Tap a result to add it.' : 'Recent and built-in foods appear here.'}</AppText>
            </View>
            {results.map((item) => (
              <Pressable key={item.id} accessibilityRole="button" onPress={() => void addCatalogFood(item)} style={({ pressed }) => pressed && styles.pressed}>
                <View style={[styles.resultRow, { borderColor: colors.border }]}>
                  <View style={styles.flex}><AppText style={styles.resultName}>{item.name}</AppText><AppText style={{ color: colors.textMuted }}>{item.brand ? `${item.brand} · ` : ''}{item.servingQuantity} {item.servingUnit} · {sourceName(item.source)}</AppText></View>
                  <View><AppText style={styles.resultCalories}>{Math.round(item.caloriesKcal)} kcal</AppText><AppText style={{ color: colors.textMuted }}>P {roundMacro(item.proteinG)} · C {roundMacro(item.carbohydrateG)} · F {roundMacro(item.fatG)}</AppText></View>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        {noMatchQuery ? (
          <View accessibilityLiveRegion="polite" style={[styles.privateFoodPrompt, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
            <View style={styles.flex}>
              <AppText style={styles.resultHeadingTitle}>Create private food for “{noMatchQuery}”</AppText>
              <AppText style={{ color: colors.textMuted }}>Enter its serving and nutrition label once, then reuse it from local search.</AppText>
            </View>
            <Button label="Create private food" onPress={beginPrivateFood} variant="quiet" />
          </View>
        ) : null}
        <AppText style={[styles.attribution, { color: colors.textMuted }]}>Sources appear on each result. USDA FoodData Central is public domain; Open Food Facts data is © contributors, ODbL. Review the serving and nutrition before adding.</AppText>
      </Card>

      <Modal visible={cameraMode != null} animationType="slide" transparent onRequestClose={closeCamera}>
        <View style={[styles.cameraOverlay, { backgroundColor: colors.overlay }]}>
          <Card style={[styles.cameraSheet, { backgroundColor: colors.surface }]}>
            <View style={styles.header}><View style={styles.flex}><AppText style={styles.sectionTitle}>{cameraMode === 'barcode' ? 'Center the barcode' : 'Frame the whole meal'}</AppText><AppText style={{ color: colors.textMuted }}>{cameraMode === 'barcode' ? 'Lookup starts automatically as soon as the code locks in.' : 'Good light and a short description improve the estimate.'}</AppText></View><Button label="Cancel" onPress={closeCamera} variant="quiet" /></View>
            <View style={[styles.cameraFrame, { backgroundColor: colors.surfaceMuted }]}>
              {cameraMode ? <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
                onCameraReady={() => setCameraReady(true)}
                onMountError={(event) => {
                  closeCamera();
                  setToolMessage(`Camera could not start: ${event.message}. Enter the barcode manually below.`);
                }}
                onBarcodeScanned={cameraMode === 'barcode' && !barcodeCaptured ? handleBarcode : undefined}
              /> : null}
              {!cameraReady ? <View style={styles.cameraLoading}><AppText style={{ color: colors.textMuted }}>Starting camera…</AppText></View> : null}
            </View>
            {cameraMode === 'photo' ? <Button label="Take photo" onPress={() => void analyzePhoto()} busy={cameraBusy} disabled={!cameraReady} /> : null}
            {cameraMode === 'barcode' ? (
              <View style={styles.scannerStatus}>
                {barcodeCaptured ? <AppText style={styles.detectedBarcode}>Detected: {barcodeValue}</AppText> : null}
                {barcodeStatus ? <View accessibilityLiveRegion="polite" style={[styles.message, { backgroundColor: cameraBusy ? colors.accentSoft : colors.warningSoft }]}><AppText>{barcodeStatus}</AppText></View> : null}
                {barcodeCaptured && !cameraBusy ? <View style={styles.photoReviewActions}><Button label="Retry lookup" onPress={() => void retryScannedBarcode()} variant="secondary" /><Button label="Scan another" onPress={scanAnotherBarcode} variant="quiet" /></View> : null}
                <AppText style={[styles.attribution, { color: colors.textMuted }]}>The scanner stays open if a product is not found. Detected digits remain in the manual field.</AppText>
              </View>
            ) : null}
          </Card>
        </View>
      </Modal>

      <Modal visible={photoFlow.selection != null} animationType="slide" transparent onRequestClose={() => {}}>
        <View style={[styles.cameraOverlay, { backgroundColor: colors.overlay }]}>
          <Card style={[styles.cameraSheet, { backgroundColor: colors.surface }]}>
            <ScrollView
              style={styles.photoSheetScroll}
              contentContainerStyle={styles.photoSheetContent}
              keyboardShouldPersistTaps="handled"
            >
            <View style={styles.header}>
              <View style={styles.flex}>
                <AppText style={styles.sectionTitle}>{photoFlow.phase === 'succeeded' ? 'Food items added' : 'Add context, then analyze'}</AppText>
                <AppText style={{ color: colors.textMuted }}>
                  {photoFlow.phase === 'succeeded'
                    ? 'Analysis is complete. Open the preview to review the editable items.'
                    : `${photoFlow.selection?.sourceLabel} is ready. Nothing is uploaded until you choose Analyze photo.`}
                </AppText>
              </View>
              {photoFlow.phase !== 'succeeded' ? <Button label="Remove photo" onPress={() => dismissPendingPhoto()} variant="quiet" disabled={cameraBusy} /> : null}
            </View>
            {photoFlow.selection ? <Image accessibilityLabel="Selected meal photo preview" source={{ uri: `data:${photoFlow.selection.mediaType};base64,${photoFlow.selection.base64}` }} resizeMode="cover" style={[styles.photoPreview, { backgroundColor: colors.surfaceMuted }]} /> : null}
            <Field
              label="What is in this meal? (optional)"
              value={photoFlow.description}
              onChangeText={(description) => dispatchPhoto({ type: 'description_changed', description })}
              placeholder="e.g. grilled chicken and rice, or the product name on this label"
              editable={!cameraBusy && photoFlow.phase !== 'succeeded'}
            />
            {photoFlow.phase === 'ready' && photoFlow.capability ? (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.message, { backgroundColor: photoFlow.capability.available ? colors.successSoft : colors.warningSoft }]}
              >
                <AppText>{photoFlow.capability.message}</AppText>
                {!photoFlow.capability.available && photoReference ? <AppText style={{ color: colors.textMuted }}>Support reference: {photoReference}</AppText> : null}
              </View>
            ) : photoFlow.phase === 'ready' ? (
              <View accessibilityLiveRegion="polite" style={[styles.message, { backgroundColor: colors.accentSoft }]}>
                <AppText>Checking secure photo-analysis availability…</AppText>
              </View>
            ) : null}
            <AppText style={[styles.attribution, { color: colors.textMuted }]}>AI estimates can be wrong. You will review and edit every portion and macro before saving.</AppText>
            {photoFlow.phase === 'analyzing' ? (
              <View accessibilityLiveRegion="assertive" style={[styles.message, { backgroundColor: colors.accentSoft }]}>
                <AppText style={{ fontWeight: '700' }}>Analyzing the visible food…</AppText>
                <AppText style={{ color: colors.textMuted }}>The selected photo and description remain available if the connection drops.</AppText>
              </View>
            ) : null}
            {photoFlow.failure ? (
              <View accessibilityRole="alert" style={[styles.message, { backgroundColor: photoFlow.failure.status === 'offline' ? colors.warningSoft : colors.dangerSoft }]}>
                <AppText style={{ color: photoFlow.failure.status === 'offline' ? colors.warning : colors.danger }}>{photoFlow.failure.message}</AppText>
                <AppText style={{ color: colors.textMuted }}>Status: {photoFlow.failure.code}</AppText>
                {photoReference ? <AppText style={{ color: colors.textMuted }}>Support reference: {photoReference}</AppText> : null}
              </View>
            ) : null}
            {photoFlow.phase === 'succeeded' && photoFlow.result ? (
              <View accessibilityLiveRegion="assertive" style={[styles.photoSuccess, { backgroundColor: colors.successSoft, borderColor: colors.success }]}>
                <AppText style={[styles.photoSuccessCount, { color: colors.success }]}>{photoFlow.result.itemCount}</AppText>
                <View style={styles.flex}>
                  <AppText style={styles.foodTitle}>editable item{photoFlow.result.itemCount === 1 ? '' : 's'} added</AppText>
                  <AppText style={{ color: colors.textMuted }}>Review the estimated portions and macros before saving this meal.</AppText>
                </View>
              </View>
            ) : null}
            {photoFlow.phase === 'succeeded' ? (
              <Button
                label={`Review ${photoFlow.result?.itemCount ?? 0} added item${photoFlow.result?.itemCount === 1 ? '' : 's'}`}
                onPress={reviewAnalyzedItems}
              />
            ) : (
              <View style={styles.photoReviewActions}>
                <Button
                  label={photoFlow.phase === 'failed'
                    ? photoFlow.failure?.retryable ? 'Try analysis again' : 'Analysis unavailable'
                    : photoFlow.capability?.available
                      ? `Analyze with ${photoFlow.capability.provider === 'anthropic' ? 'Anthropic' : 'Gemini'}`
                      : photoAccessStatus === 'consent_required'
                        ? 'AI consent required'
                        : photoAccessStatus === 'not_configured'
                          ? 'Connect Gemini first'
                          : photoFlow.capability ? 'Analysis unavailable' : 'Checking availability...'}
                  onPress={() => void analyzePendingPhoto()}
                  busy={cameraBusy}
                  disabled={!photoCanAnalyze}
                />
                {photoAccessStatus === 'auth_required' ? (
                  <Button label="Open Account" onPress={() => router.push('/settings/account')} variant="secondary" disabled={cameraBusy} />
                ) : null}
                {photoAccessStatus === 'consent_required' ? (
                  <Button
                    label="Review AI consent"
                    onPress={() => router.push({
                      pathname: '/onboarding',
                      params: { edit: '1', section: 'ai-consent', returnTo: 'meal-photo' },
                    })}
                    variant="secondary"
                    disabled={cameraBusy}
                  />
                ) : null}
                {photoAccessStatus === 'not_configured' ? (
                  <Button
                    label="Open AI connection"
                    onPress={() => router.push('/settings/ai' as never)}
                    variant="secondary"
                    disabled={cameraBusy}
                  />
                ) : null}
                {!photoCanAnalyze && (photoFlow.capability || photoFlow.failure) ? (
                  <Button
                    label={photoAccessStatus === 'not_configured' ? 'Check connection again' : 'Check availability again'}
                    onPress={() => void refreshPhotoCapability()}
                    variant="quiet"
                    disabled={cameraBusy}
                  />
                ) : null}
                <Button label="Save photo for later" onPress={() => void queuePendingPhoto()} variant="secondary" disabled={cameraBusy} />
                <Button label="Enter manually instead" onPress={() => dismissPendingPhoto(true)} variant="secondary" disabled={cameraBusy} />
              </View>
            )}
            </ScrollView>
          </Card>
        </View>
      </Modal>

      {toolMessage ? <View accessibilityLiveRegion="polite" style={[styles.message, { backgroundColor: colors.accentSoft }]}><AppText>{toolMessage}</AppText></View> : null}
      {formError ? <View accessibilityRole="alert" style={[styles.message, { backgroundColor: colors.dangerSoft }]}><AppText style={{ color: colors.danger }}>{formError}</AppText></View> : null}

      <View onLayout={(event) => { mealItemsYRef.current = event.nativeEvent.layout.y; }} style={styles.mealItemsSection}>
      <SectionHeading title="Meal items" detail="Database and photo-analysis values remain editable" />
      {foods.map((food, index) => (
        <Card key={food.key}>
          <View style={styles.header}><View style={styles.flex}><AppText style={styles.foodTitle}>Food {index + 1}</AppText>{food.sourceLabel ? <AppText style={{ color: colors.textMuted }}>{food.sourceLabel}{food.confidence != null ? ` · ${Math.round(food.confidence * 100)}% confidence` : ''}</AppText> : null}</View>{foods.length > 1 ? <Button label="Remove" onPress={() => setFoods((current) => current.filter((item) => item.key !== food.key))} variant="quiet" /> : null}</View>
          <Field label="Food" value={food.name} onChangeText={(value) => update(food.key, 'name', value)} placeholder="Chicken rice" />
          <View style={styles.portionSection}>
            <Field label="Quantity" value={food.quantity} onChangeText={(value) => updateQuantity(food.key, value)} keyboardType="decimal-pad" containerStyle={styles.quantityField} />
            <View style={styles.unitSection}>
              <AppText style={styles.unitLabel}>Unit</AppText>
              <View style={styles.typeWrap}>{servingUnitOptions(food.unit).map((unit) => <Pill key={unit} label={unit} active={food.unit === unit} onPress={() => updateUnit(food.key, unit)} />)}</View>
            </View>
          </View>
          <AppText style={[styles.autoNote, { color: colors.textMuted }]}>Changing the quantity scales calories and macros automatically. Changing compatible units keeps the same physical portion.</AppText>
          <View style={styles.fieldGrid}>
            <Field label="Calories" value={food.calories} onChangeText={(value) => updateMacro(food.key, 'calories', value)} keyboardType="decimal-pad" placeholder="kcal" containerStyle={styles.macroField} />
            <Field label="Protein (g)" value={food.protein} onChangeText={(value) => updateMacro(food.key, 'protein', value)} keyboardType="decimal-pad" containerStyle={styles.macroField} />
            <Field label="Carbs (g)" value={food.carbs} onChangeText={(value) => updateMacro(food.key, 'carbs', value)} keyboardType="decimal-pad" containerStyle={styles.macroField} />
            <Field label="Fat (g)" value={food.fat} onChangeText={(value) => updateMacro(food.key, 'fat', value)} keyboardType="decimal-pad" containerStyle={styles.macroField} />
            <Field label="Fibre (g)" value={food.fibre} onChangeText={(value) => updateMacro(food.key, 'fibre', value)} keyboardType="decimal-pad" containerStyle={styles.macroField} />
          </View>
          <View style={[styles.privateFoodAction, { borderColor: colors.border }]}>
            <View style={styles.flex}>
              <AppText style={styles.resultHeadingTitle}>{food.catalogId?.startsWith('custom-') ? 'Private food saved' : 'Reuse this food'}</AppText>
              <AppText style={{ color: colors.textMuted }}>{food.catalogId?.startsWith('custom-')
                ? 'Update the saved serving after changing these values.'
                : 'Save this serving privately on this device. Your meal can still be saved separately.'}</AppText>
            </View>
            <Button
              label={food.catalogId?.startsWith('custom-') ? 'Update private food' : 'Save as private food'}
              onPress={() => void saveFoodForReuse(food)}
              busy={savingPrivateFoodKey === food.key}
              disabled={!isCompletedFood(food) || (savingPrivateFoodKey != null && savingPrivateFoodKey !== food.key)}
              variant="quiet"
            />
          </View>
          {food.source === 'ai_photo' ? <AppText style={[styles.attribution, { color: colors.warning }]}>AI estimate—review before saving. Not medical advice.</AppText> : null}
        </Card>
      ))}
      <Button label="Add a blank food" onPress={() => setFoods((current) => [...current, emptyFood()])} variant="secondary" />
      </View>
      <SectionHeading title="Finish" detail="Review exactly what will be saved locally, even without a connection" />
      <Card style={{ backgroundColor: draftSummary.needsAttentionCount ? colors.warningSoft : colors.surfaceMuted, borderColor: draftSummary.needsAttentionCount ? colors.warning : colors.border }}>
        <View style={styles.draftSummaryHeader}>
          <View style={styles.flex}>
            <AppText style={styles.sectionTitle}>{draftSummary.needsAttentionCount
              ? `${draftSummary.needsAttentionCount} food row${draftSummary.needsAttentionCount === 1 ? '' : 's'} need attention`
              : draftSummary.completedFoodCount ? 'Meal ready to save' : 'No foods added'}</AppText>
            <AppText style={{ color: colors.textMuted }}>{draftSummary.needsAttentionCount
              ? 'Every started row needs a food name, a positive portion, and non-negative calories and macros.'
              : `${draftSummary.blankFoodCount} untouched row${draftSummary.blankFoodCount === 1 ? '' : 's'} will be ignored.`}</AppText>
          </View>
        </View>
        <View style={styles.mealSummaryGrid}>
          <MealSummaryMetric label="foods ready" value={String(draftSummary.completedFoodCount)} />
          <MealSummaryMetric label="kcal" value={formatFoodNumber(draftSummary.totals.caloriesKcal)} />
          <MealSummaryMetric label="protein" value={`${formatFoodNumber(draftSummary.totals.proteinG)} g`} />
          <MealSummaryMetric label="carbs" value={`${formatFoodNumber(draftSummary.totals.carbohydrateG)} g`} />
          <MealSummaryMetric label="fat" value={`${formatFoodNumber(draftSummary.totals.fatG)} g`} />
        </View>
      </Card>
      <Button label="Save meal" onPress={() => void submit()} busy={saving} />
    </Screen>
  );
}

function toDraftFood(item: FoodCatalogItem): DraftFood {
  return {
    key: Crypto.randomUUID(),
    catalogId: item.id,
    name: item.name,
    quantity: String(item.servingQuantity),
    unit: item.servingUnit,
    calories: String(roundMacro(item.caloriesKcal)),
    protein: String(roundMacro(item.proteinG)),
    carbs: String(roundMacro(item.carbohydrateG)),
    fat: String(roundMacro(item.fatG)),
    fibre: item.fibreG == null ? '' : String(roundMacro(item.fibreG)),
    source: item.source === 'ai_photo' ? 'ai_photo' : item.source === 'starter' || item.source === 'custom' ? 'manual' : 'imported',
    sourceLabel: sourceName(item.source),
    confidence: item.confidence,
    referenceQuantity: item.servingQuantity,
    referenceUnit: item.servingUnit,
    referenceMacros: {
      caloriesKcal: item.caloriesKcal,
      proteinG: item.proteinG,
      carbohydrateG: item.carbohydrateG,
      fatG: item.fatG,
      fibreG: item.fibreG ?? 0,
    },
  };
}

function macroStrings(macros: ServingMacros): Pick<DraftFood, 'calories' | 'protein' | 'carbs' | 'fat' | 'fibre'> {
  return {
    calories: formatFoodNumber(macros.caloriesKcal),
    protein: formatFoodNumber(macros.proteinG),
    carbs: formatFoodNumber(macros.carbohydrateG),
    fat: formatFoodNumber(macros.fatG),
    fibre: formatFoodNumber(macros.fibreG),
  };
}

function currentMacros(food: DraftFood): ServingMacros {
  return {
    caloriesKcal: Number(food.calories) || 0,
    proteinG: Number(food.protein) || 0,
    carbohydrateG: Number(food.carbs) || 0,
    fatG: Number(food.fat) || 0,
    fibreG: Number(food.fibre) || 0,
  };
}

function macroReferenceKey(field: 'calories' | 'protein' | 'carbs' | 'fat' | 'fibre'): keyof ServingMacros {
  if (field === 'calories') return 'caloriesKcal';
  if (field === 'protein') return 'proteinG';
  if (field === 'carbs') return 'carbohydrateG';
  if (field === 'fat') return 'fatG';
  return 'fibreG';
}

function formatFoodNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

async function prepareWebPhoto(file: File): Promise<PendingMealPhoto> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    if (file.size > 2_000_000) throw new Error('This browser needs a photo under 2 MB. Try a tighter crop.');
    const dataUrl = await readFileAsDataUrl(file);
    const base64 = dataUrl.split(',')[1];
    if (!base64 || base64.length > MAX_WEB_MEAL_PHOTO_BASE64_LENGTH) {
      throw new Error('That photo is still too large. Try a tighter crop.');
    }
    return { base64, mediaType: file.type || 'image/jpeg', sourceLabel: file.name || 'Selected photo' };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1280 / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not prepare that photo.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The browser could not compress that photo.')), 'image/jpeg', 0.68);
    });
    const dataUrl = await readFileAsDataUrl(blob);
    const base64 = dataUrl.split(',')[1];
    if (!base64 || base64.length > MAX_WEB_MEAL_PHOTO_BASE64_LENGTH) throw new Error('That photo is still too large to analyze. Try a tighter crop.');
    return { base64, mediaType: 'image/jpeg', sourceLabel: file.name || 'Selected photo' };
  } finally {
    bitmap.close();
  }
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected photo could not be read.'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The selected photo had an unsupported format.'));
    reader.readAsDataURL(file);
  });
}

const isBlankFood = isBlankMealDraftFood;

function MealSummaryMetric({ label, value }: { label: string; value: string }) {
  const { colors } = useJienTheme();
  return <View style={styles.mealSummaryMetric}><AppText style={styles.mealSummaryValue}>{value}</AppText><AppText style={{ color: colors.textMuted }}>{label}</AppText></View>;
}

function sourceName(source: FoodCatalogItem['source']): string {
  if (source === 'custom') return 'Private food';
  if (source === 'usda_fdc') return 'USDA FoodData Central';
  if (source === 'open_food_facts') return 'Open Food Facts';
  if (source === 'fatsecret') return 'FatSecret Platform';
  if (source === 'ai_photo') return 'AI photo estimate';
  return 'Starter estimate';
}

function onlineFoodSourceSummary(items: FoodCatalogItem[]): string {
  const sources = [...new Set(items.map((item) => sourceName(item.source)))];
  if (sources.length <= 1) return sources[0] ?? 'the online database';
  return `${sources.slice(0, -1).join(', ')} and ${sources.at(-1)}`;
}

function isCompletedFood(food: DraftFood): boolean {
  return summarizeMealDraft([food]).completedFoodCount === 1;
}

function roundMacro(value: number): number {
  return Math.round(value * 10) / 10;
}

const styles = StyleSheet.create({
  screenContent: { width: '100%', maxWidth: 980, alignSelf: 'center' },
  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  discoveryCard: { padding: spacing.lg },
  discoveryHeader: { flexDirection: 'row', gap: spacing.sm },
  sectionTitle: { ...typography.section, fontWeight: '700' },
  toolActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  webPhotoButton: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radii.control, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' },
  webPhotoLabel: { fontWeight: '700' },
  barcodeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.sm },
  results: { gap: 0 },
  resultHeading: { gap: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  resultHeadingTitle: { ...typography.label, fontWeight: '800' },
  resultRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  resultName: { fontWeight: '700' },
  resultCalories: { fontWeight: '800', textAlign: 'right' },
  attribution: { ...typography.caption },
  privateFoodPrompt: { minHeight: 76, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  cameraFrame: { width: '100%', maxWidth: 640, alignSelf: 'center', aspectRatio: 4 / 3, overflow: 'hidden', borderRadius: radii.card },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end' },
  cameraSheet: { width: '100%', maxWidth: 760, maxHeight: '96%', alignSelf: 'center', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: spacing.lg },
  cameraLoading: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  scannerStatus: { gap: spacing.xs },
  detectedBarcode: { ...typography.bodyLarge, fontWeight: '800', fontVariant: ['tabular-nums'] },
  photoPreview: { width: '100%', maxWidth: 640, alignSelf: 'center', aspectRatio: 4 / 3, borderRadius: radii.card },
  photoSheetScroll: { width: '100%' },
  photoSheetContent: { gap: spacing.sm, paddingBottom: spacing.xs },
  photoReviewActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoSuccess: { minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photoSuccessCount: { ...typography.title, fontWeight: '800', minWidth: 36, textAlign: 'center', fontVariant: ['tabular-nums'] },
  message: { padding: spacing.md, borderRadius: radii.control },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  foodTitle: { ...typography.section, fontWeight: '700' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  privateFoodAction: { minHeight: 76, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  portionSection: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.md },
  quantityField: { flexBasis: 160, flexGrow: 0 },
  unitSection: { flex: 1, minWidth: 220, gap: spacing.xs },
  unitLabel: { ...typography.label, fontWeight: '700' },
  autoNote: { ...typography.caption },
  draftSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mealSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  mealSummaryMetric: { flexGrow: 1, flexBasis: 112 },
  mealSummaryValue: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mealItemsSection: { gap: spacing.lg },
  gridField: { flexGrow: 1, flexBasis: 240, minWidth: 140 },
  macroField: { flexGrow: 1, flexBasis: 150, minWidth: 118 },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
});
