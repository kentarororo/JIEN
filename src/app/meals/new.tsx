import * as Crypto from 'expo-crypto';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { File as ExpoFile } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { createElement, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, SectionHeading } from '@/components/ui';
import {
  analyzeMealPhoto,
  cacheFoodCatalogItems,
  lookupFoodBarcode,
  markFoodCatalogItemUsed,
  saveMeal,
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
import { formatShortDate, localTimestampForDate } from '@/lib/time';
import { resolveMealPhotoPickerResult } from '@/lib/media/image-picker';

type DraftFood = {
  key: string;
  catalogId: string | null;
  name: string;
  quantity: string;
  unit: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fibre: string;
  source: 'manual' | 'ai_photo' | 'imported';
  sourceLabel: string | null;
  confidence: number | null;
  referenceQuantity: number;
  referenceUnit: string;
  referenceMacros: ServingMacros;
};

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
  const { date } = useLocalSearchParams<{ date?: string }>();
  const { colors } = useJienTheme();
  const cameraRef = useRef<CameraView>(null);
  const barcodeLockRef = useRef(false);
  const pendingPickerResultRef = useRef<ReturnType<typeof ImagePicker.getPendingResultAsync> | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const now = new Date();
  const inferred: MealType = now.getHours() < 11 ? 'breakfast' : now.getHours() < 15 ? 'lunch' : now.getHours() < 19 ? 'dinner' : 'snack';
  const [name, setName] = useState('Meal');
  const [type, setType] = useState<MealType>(inferred);
  const [foods, setFoods] = useState<DraftFood[]>([emptyFood()]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodCatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [photoDescription, setPhotoDescription] = useState('');
  const [barcodeValue, setBarcodeValue] = useState('');
  const [toolMessage, setToolMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      void searchLocalFoodCatalog(db, query).then(setResults).catch((cause) => {
        setToolMessage(cause instanceof Error ? cause.message : 'Could not search saved foods.');
      });
    }, 160);
    return () => clearTimeout(timer);
  }, [db, query]);

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
    if (item.source !== 'ai_photo') await markFoodCatalogItemUsed(db, item.id);
  };

  const runDatabaseSearch = async () => {
    if (query.trim().length < 2) {
      setToolMessage('Enter at least two characters to search the online database.');
      return;
    }
    setSearching(true);
    setToolMessage(null);
    try {
      const items = await searchFoodDatabase(query);
      await cacheFoodCatalogItems(db, items);
      setResults(items);
      setToolMessage(items.length ? `Found ${items.length} Open Food Facts matches.` : 'No database matches found.');
    } catch (cause) {
      setToolMessage(cause instanceof Error ? cause.message : 'Online food search is unavailable.');
    } finally {
      setSearching(false);
    }
  };

  const openCamera = async (mode: Exclude<CameraMode, null>) => {
    setToolMessage(null);
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
    setCameraMode(null);
  };

  const hideCameraDuringLookup = () => {
    setCameraReady(false);
    setCameraMode(null);
  };

  const handleBarcode = async ({ data }: BarcodeScanningResult) => {
    if (cameraBusy || barcodeLockRef.current) return;
    barcodeLockRef.current = true;
    hideCameraDuringLookup();
    try {
      await lookupBarcode(data);
    } finally {
      barcodeLockRef.current = false;
    }
  };

  const lookupBarcode = async (value = barcodeValue) => {
    if (cameraBusy) return;
    setCameraBusy(true);
    try {
      const items = await lookupFoodBarcode(value);
      await cacheFoodCatalogItems(db, items);
      if (!items[0]) throw new Error('No food matched that barcode.');
      await addCatalogFood(items[0]);
      setBarcodeValue('');
      setToolMessage(`${items[0].name} added from Open Food Facts. Review the serving and macros.`);
    } catch (cause) {
      setToolMessage(cause instanceof Error ? cause.message : 'Could not look up that barcode.');
    } finally {
      setCameraBusy(false);
    }
  };

  const addAnalyzedPhoto = async (base64: string, mediaType = 'image/jpeg') => {
    const items = await analyzeMealPhoto(base64, photoDescription, mediaType);
    if (!items.length) throw new Error('No food items were identified. Try a clearer photo or add a description.');
    const drafts = items.map(toDraftFood);
    setFoods((current) => current.length === 1 && isBlankFood(current[0]!) ? drafts : [...current, ...drafts]);
    closeCamera();
    setToolMessage(`Added ${items.length} AI-estimated item${items.length === 1 ? '' : 's'}. Review every portion and macro before saving. Not medical advice.`);
  };

  const prepareAndAnalyzePhoto = async (uri: string, width?: number) => {
    const context = ImageManipulator.manipulate(uri);
    if (width != null && width > 1280) context.resize({ width: 1280, height: null });
    const rendered = await context.renderAsync();
    const resized = await rendered.saveAsync({ compress: 0.68, format: SaveFormat.JPEG, base64: true });
    if (!resized.base64) throw new Error('The meal photo could not be prepared for analysis.');
    try {
      await addAnalyzedPhoto(resized.base64, 'image/jpeg');
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
    setToolMessage('Analyzing the visible meal…');
    try {
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!picture?.uri) throw new Error('The camera did not return an image to analyze.');
      await prepareAndAnalyzePhoto(picture.uri, picture.width);
    } catch (cause) {
      setToolMessage(cause instanceof Error ? cause.message : 'The meal photo could not be analyzed.');
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
      await prepareAndAnalyzePhoto(resolution.asset.uri, resolution.asset.width);
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
        await prepareAndAnalyzePhoto(resolution.asset.uri, resolution.asset.width);
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
    setToolMessage('Uploading the selected photo for analysis...');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.split(',')[1];
      if (!base64) throw new Error('The selected photo could not be read.');
      await addAnalyzedPhoto(base64, file.type || 'image/jpeg');
    } catch (cause) {
      setToolMessage(cause instanceof Error ? cause.message : 'The meal photo could not be analyzed.');
    } finally {
      if (event.target) event.target.value = '';
      setCameraBusy(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setFormError(null);
    try {
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
      await saveMeal(db, { name, type, eatenAt, items });
      await reconcileMealGapNotification(db);
      router.back();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Please check the meal and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      {date ? <Card style={{ backgroundColor: colors.surfaceMuted }}><AppText>Logging for <AppText style={{ fontWeight: '800' }}>{formatShortDate(`${date}T12:00:00`)}</AppText></AppText></Card> : null}
      <Field label="Meal name" value={name} onChangeText={setName} placeholder="Dinner" />
      <View style={styles.typeWrap}>{MEAL_TYPES.map((mealType) => <Pill key={mealType} label={mealType[0]!.toUpperCase() + mealType.slice(1)} active={type === mealType} onPress={() => setType(mealType)} />)}</View>

      <Card style={styles.discoveryCard}>
        <View style={styles.discoveryHeader}><View style={styles.flex}><AppText style={styles.sectionTitle}>Find food quickly</AppText><AppText style={{ color: colors.textMuted }}>Search local foods instantly, then expand to the online database.</AppText></View></View>
        <Field label="Food search" value={query} onChangeText={setQuery} placeholder="Try chicken, rice, yogurt…" returnKeyType="search" onSubmitEditing={() => void runDatabaseSearch()} />
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
        <Field label="Meal photo context (optional)" value={photoDescription} onChangeText={setPhotoDescription} placeholder="e.g. grilled chicken, rice, sauce on the side" />
        <View style={styles.barcodeRow}>
          <Field label="Barcode number" value={barcodeValue} onChangeText={setBarcodeValue} placeholder="Enter if camera scanning is unavailable" keyboardType="number-pad" returnKeyType="search" onSubmitEditing={() => void lookupBarcode()} containerStyle={styles.flex} />
          <Button label="Look up barcode" onPress={() => void lookupBarcode()} busy={cameraBusy} variant="secondary" />
        </View>

        {results.length ? (
          <View style={styles.results}>
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
        <AppText style={[styles.attribution, { color: colors.textMuted }]}>Online food and barcode data: Open Food Facts contributors (ODbL). Search works without a JIEN account.</AppText>
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
                onBarcodeScanned={cameraMode === 'barcode' ? handleBarcode : undefined}
              /> : null}
              {!cameraReady ? <View style={styles.cameraLoading}><AppText style={{ color: colors.textMuted }}>Starting camera…</AppText></View> : null}
            </View>
            {cameraMode === 'photo' ? <Button label="Take photo and estimate" onPress={() => void analyzePhoto()} busy={cameraBusy} disabled={!cameraReady} /> : null}
            {cameraMode === 'barcode' ? <AppText style={[styles.attribution, { color: colors.textMuted }]}>If camera permission is blocked, cancel and use the barcode number field.</AppText> : null}
          </Card>
        </View>
      </Modal>

      {toolMessage ? <View accessibilityLiveRegion="polite" style={[styles.message, { backgroundColor: colors.accentSoft }]}><AppText>{toolMessage}</AppText></View> : null}
      {formError ? <View accessibilityRole="alert" style={[styles.message, { backgroundColor: colors.dangerSoft }]}><AppText style={{ color: colors.danger }}>{formError}</AppText></View> : null}

      <SectionHeading title="Meal items" detail="Database and AI values stay editable" />
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
          {food.source === 'ai_photo' ? <AppText style={[styles.attribution, { color: colors.warning }]}>AI estimate—review before saving. Not medical advice.</AppText> : null}
        </Card>
      ))}
      <Button label="Add a blank food" onPress={() => setFoods((current) => [...current, emptyFood()])} variant="secondary" />
      <SectionHeading title="Finish" detail="Saved locally, even without a connection" />
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
    source: item.source === 'ai_photo' ? 'ai_photo' : item.source === 'starter' ? 'manual' : 'imported',
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected photo could not be read.'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The selected photo had an unsupported format.'));
    reader.readAsDataURL(file);
  });
}

function isBlankFood(food: DraftFood): boolean {
  return !food.name.trim() && !food.calories.trim() && !food.protein.trim() && !food.carbs.trim() && !food.fat.trim();
}

function sourceName(source: FoodCatalogItem['source']): string {
  if (source === 'usda_fdc') return 'USDA FoodData Central';
  if (source === 'open_food_facts') return 'Open Food Facts';
  if (source === 'ai_photo') return 'AI photo estimate';
  return 'JIEN starter estimate';
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
  resultRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  resultName: { fontWeight: '700' },
  resultCalories: { fontWeight: '800', textAlign: 'right' },
  attribution: { ...typography.caption },
  cameraFrame: { width: '100%', maxWidth: 640, alignSelf: 'center', aspectRatio: 4 / 3, overflow: 'hidden', borderRadius: radii.card },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end' },
  cameraSheet: { width: '100%', maxWidth: 760, maxHeight: '96%', alignSelf: 'center', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: spacing.lg },
  cameraLoading: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  message: { padding: spacing.md, borderRadius: radii.control },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  foodTitle: { ...typography.section, fontWeight: '700' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  portionSection: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.md },
  quantityField: { flexBasis: 160, flexGrow: 0 },
  unitSection: { flex: 1, minWidth: 220, gap: spacing.xs },
  unitLabel: { ...typography.label, fontWeight: '700' },
  autoNote: { ...typography.caption },
  gridField: { flexGrow: 1, flexBasis: 240, minWidth: 140 },
  macroField: { flexGrow: 1, flexBasis: 150, minWidth: 118 },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
});
