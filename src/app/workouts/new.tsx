import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, SectionHeading, StatePanel } from '@/components/ui';
import { JointProgressionChoicePanel, type JointProgressionChoice } from '@/components/joint-progression-choice';
import {
  createCustomExercise,
  completePlannedWorkout,
  getRecentExerciseSessionSets,
  getWorkoutDraft,
  getWorkoutDraftOwnerId,
  getWorkoutDetail,
  getUserProfile,
  listExercises,
  saveWorkout,
  saveWorkoutDraft,
  updateWorkout,
  type Exercise,
  type LoadUnit,
  type SetKind,
  type WorkoutDetail,
} from '@/lib/db';
import {
  buildCompletedExerciseVolumeFeedback,
  buildSetProgressionPlan,
  calculateRecentExerciseBaseline,
  MUSCLE_GROUP_OPTIONS,
  MUSCLE_GROUP_SECTIONS,
  muscleGroupFamilyKey,
  muscleGroupFamilyLabel,
  muscleGroupLabel,
  type CompletedExerciseVolumeFeedback,
  type ProgressionSet,
  type SetProgressionCue,
  type SetProgressionPlan,
} from '@/lib/progression';
import { exerciseEquipmentLabel, filterExerciseCatalog } from '@/lib/training/exercise-catalog';
import { hasStoredJointConsideration } from '@/lib/planning/workout-plan';
import { radii, spacing, typography, useJienTheme } from '@/theme';
import { formatShortDate, localTimestampForDate } from '@/lib/time';
import {
  fillBlankWorkoutLoads,
  latestValidWorkoutLoad,
  prefillWorkoutSetFromHistory,
  parseWorkoutDraft,
  legacyWorkoutDraftStorageKey,
  summarizeWorkoutDraft,
  workoutDraftContext,
  workoutDraftStorageKey,
} from '@/lib/workout-draft';

type DraftSet = {
  key: string;
  id?: string;
  load: string;
  reps: string;
  rpe: string;
  kind: SetKind;
  completed: boolean;
};
type DraftExercise = {
  key: string;
  exerciseId: string;
  sets: DraftSet[];
  progression: SetProgressionPlan | null;
  sourceSets: ProgressionSet[] | null;
  baselineSessions: ProgressionSet[][] | null;
  historyStatus: 'idle' | 'loading' | 'ready' | 'error';
  historyRequestId: string | null;
};

const COMMON_EXERCISE_COUNT = 12;
const newSet = (
  load = '',
  reps = '',
  rpe = '',
  id?: string,
  kind: SetKind = 'working',
  completed = false,
): DraftSet => ({ key: Crypto.randomUUID(), id, load, reps, rpe, kind, completed });
const newBlock = (exerciseId: string): DraftExercise => ({
  key: Crypto.randomUUID(),
  exerciseId,
  sets: [newSet(), newSet(), newSet()],
  progression: null,
  sourceSets: null,
  baselineSessions: null,
  historyStatus: 'idle',
  historyRequestId: null,
});
const isRowEmpty = (set: DraftSet) => !set.load.trim() && !set.reps.trim() && !set.rpe.trim();

export default function NewWorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { templateWorkoutId, planWorkoutId, editWorkoutId, date } = useLocalSearchParams<{ templateWorkoutId?: string; planWorkoutId?: string; editWorkoutId?: string; date?: string }>();
  const workoutIdRef = useRef(editWorkoutId ?? planWorkoutId ?? Crypto.randomUUID());
  const submitLockRef = useRef(false);
  const draftPersistenceActiveRef = useRef(true);
  const { width } = useWindowDimensions();
  const compact = width < 520;
  const { colors } = useJienTheme();
  const [catalog, setCatalog] = useState<Exercise[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState('Training session');
  const [unit, setUnit] = useState<LoadUnit>('kg');
  const [hasJointConsideration, setHasJointConsideration] = useState(false);
  const [jointProgressionChoice, setJointProgressionChoice] = useState<JointProgressionChoice>('hold');
  const [blocks, setBlocks] = useState<DraftExercise[]>([]);
  const [exerciseQueries, setExerciseQueries] = useState<Record<string, string>>({});
  const [exerciseBrowsers, setExerciseBrowsers] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [editStartedAt, setEditStartedAt] = useState<string | null>(null);
  const [draftOwnerUserId, setDraftOwnerUserId] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftRecovered, setDraftRecovered] = useState(false);
  const [restTimerSeconds, setRestTimerSeconds] = useState(0);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [showRpeGuide, setShowRpeGuide] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [customMuscle, setCustomMuscle] = useState<string>(MUSCLE_GROUP_OPTIONS[0].value);
  const [customSecondaryMuscles, setCustomSecondaryMuscles] = useState<string[]>([]);
  const [customSaving, setCustomSaving] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoadError(null);
    try {
      const [exercises, profile, template] = await Promise.all([
        listExercises(db),
        getUserProfile(db),
        templateWorkoutId || planWorkoutId || editWorkoutId
          ? getWorkoutDetail(db, editWorkoutId ?? planWorkoutId ?? templateWorkoutId!)
          : Promise.resolve(null),
      ]);
      setCatalog(exercises);
      setHasJointConsideration(hasStoredJointConsideration(profile?.injuryFlags));
      setJointProgressionChoice(template?.plan?.jointProgressionChoice ?? 'hold');
      if (template?.sets[0]) setUnit(template.sets[0].loadUnit);
      else if (template?.plan?.exercises[0]?.sets[0]) setUnit(template.plan.exercises[0].sets[0].loadUnit);
      else if (profile) setUnit(profile.preferredLoadUnit);
      if (template) {
        setTitle(template.title);
        setEditStartedAt(editWorkoutId ? template.completedAt : null);
        setBlocks(template.status === 'planned'
          ? blocksFromPlan(template)
          : editWorkoutId ? blocksFromEdit(template) : blocksFromTemplate(template));
      } else {
        setBlocks((current) => current.length ? current : [newBlock(exercises[0]?.id ?? '')]);
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load exercises.');
    }
  }, [db, editWorkoutId, planWorkoutId, templateWorkoutId]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const draftContext = useMemo(() => workoutDraftContext({ date, templateWorkoutId, planWorkoutId, editWorkoutId }), [date, editWorkoutId, planWorkoutId, templateWorkoutId]);
  const draftSummary = useMemo(() => summarizeWorkoutDraft(blocks), [blocks]);
  const draftMuscleCredits = useMemo(() => summarizeDraftMuscleCredits(blocks, catalog ?? []), [blocks, catalog]);

  useEffect(() => {
    let active = true;
    void getWorkoutDraftOwnerId(db).then((owner) => {
      if (active) setDraftOwnerUserId(owner);
    }).catch(() => {
      if (active) setDraftOwnerUserId('local-device');
    });
    return () => { active = false; };
  }, [db]);

  useEffect(() => {
    if (!catalog || !draftOwnerUserId || draftReady) return;
    let active = true;
    void (async () => {
      let recovered = await getWorkoutDraft(db, draftOwnerUserId, draftContext);
      if (!recovered && process.env.EXPO_OS === 'web') {
        recovered = parseWorkoutDraft(
          globalThis.localStorage?.getItem(workoutDraftStorageKey(draftOwnerUserId, draftContext))
            ?? globalThis.localStorage?.getItem(legacyWorkoutDraftStorageKey(draftOwnerUserId, draftContext))
            ?? null,
          draftOwnerUserId,
          draftContext,
        );
        if (recovered) await saveWorkoutDraft(db, recovered);
      }
      if (!active) return;
      if (recovered) {
        workoutIdRef.current = recovered.workoutId;
        setTitle(recovered.title);
        setUnit(recovered.unit);
        setEditStartedAt(recovered.startedAt);
        setRestTimerSeconds(recovered.restTimerSeconds);
        setRestEndsAt(recovered.restEndsAt && recovered.restEndsAt > Date.now() ? recovered.restEndsAt : null);
        setBlocks(recovered.blocks.map((block) => ({
          key: Crypto.randomUUID(),
          exerciseId: block.exerciseId,
          sets: block.sets.map((set) => newSet(set.load, set.reps, set.rpe, set.id, set.kind, set.completed)),
          progression: null,
          sourceSets: null,
          baselineSessions: null,
          historyStatus: 'idle',
          historyRequestId: null,
        })));
        setDraftRecovered(true);
      }
      setDraftReady(true);
    })().catch(() => {
      if (active) setDraftReady(true);
    });
    return () => { active = false; };
  }, [catalog, db, draftContext, draftOwnerUserId, draftReady]);

  useEffect(() => {
    if (!draftReady || !draftOwnerUserId || blocks.length === 0) return;
    const draft = {
      version: 2 as const,
      ownerUserId: draftOwnerUserId,
      workoutId: workoutIdRef.current,
      context: draftContext,
      title,
      unit,
      startedAt: editStartedAt,
      updatedAt: new Date().toISOString(),
      restTimerSeconds,
      restEndsAt,
      blocks: blocks.map((block) => ({
        exerciseId: block.exerciseId,
        sets: block.sets.map(({ id, load, reps, rpe, kind, completed }) => ({ id, load, reps, rpe, kind, completed })),
      })),
    };
    const persist = () => {
      if (draftPersistenceActiveRef.current) void saveWorkoutDraft(db, draft);
    };
    const timer = setTimeout(persist, 250);
    return () => {
      clearTimeout(timer);
      persist();
    };
  }, [blocks, db, draftContext, draftOwnerUserId, draftReady, editStartedAt, restEndsAt, restTimerSeconds, title, unit]);

  useEffect(() => {
    if (restEndsAt == null) return;
    setTimerNow(Date.now());
    const timer = setInterval(() => {
      const now = Date.now();
      setTimerNow(now);
      if (now >= restEndsAt) setRestEndsAt(null);
    }, 1_000);
    return () => clearInterval(timer);
  }, [restEndsAt]);

  const jointProgressionHold = hasJointConsideration && jointProgressionChoice === 'hold';

  const updateProgression = useCallback(async (blockKey: string, exerciseId: string) => {
    const exercise = catalog?.find((item) => item.id === exerciseId);
    if (!exercise) return;
    const requestId = Crypto.randomUUID();
    setBlocks((current) => {
      let updated = false;
      const next = current.map((block) => {
        if (block.key !== blockKey || block.exerciseId !== exerciseId) return block;
        updated = true;
        return { ...block, historyStatus: 'loading' as const, historyRequestId: requestId };
      });
      return updated ? next : current;
    });
    try {
      const recentSessions = await getRecentExerciseSessionSets(db, exerciseId, {
        excludeWorkoutId: editWorkoutId,
        beforeCompletedAt: editWorkoutId ? editStartedAt ?? undefined : undefined,
      });
      const rawHistory = recentSessions[0] ?? [];
      const history = rawHistory.map((set) => ({
        ...set,
        loadValue: convertLoadValue(set.loadValue, set.loadUnit, unit),
        loadUnit: unit,
      }));
      const progression = buildSetProgressionPlan({
        sets: history,
        repMin: exercise.targetRepMin,
        repMax: exercise.targetRepMax,
        loadIncrement: unit === 'lb' ? Math.max(5, exercise.loadIncrement) : exercise.loadIncrement,
        jointFlag: jointProgressionHold,
      });
      setBlocks((current) => {
        let updated = false;
        const next = current.map((block) => {
          if (block.key !== blockKey || block.exerciseId !== exerciseId || block.historyRequestId !== requestId) return block;
          updated = true;
          return {
            ...block,
            progression,
            sourceSets: history,
            baselineSessions: recentSessions,
            historyStatus: 'ready' as const,
            historyRequestId: null,
          };
        });
        return updated ? next : current;
      });
    } catch {
      setBlocks((current) => {
        let updated = false;
        const next = current.map((block) => {
          if (block.key !== blockKey || block.exerciseId !== exerciseId || block.historyRequestId !== requestId) return block;
          updated = true;
          return { ...block, progression: null, sourceSets: null, baselineSessions: null, historyStatus: 'error' as const, historyRequestId: null };
        });
        return updated ? next : current;
      });
    }
  }, [catalog, db, editStartedAt, editWorkoutId, jointProgressionHold, unit]);

  const chooseJointProgression = (choice: JointProgressionChoice) => {
    setJointProgressionChoice(choice);
    setBlocks((current) => current.map((block) => ({
      ...block,
      progression: null,
      historyStatus: 'idle',
      historyRequestId: null,
    })));
  };

  useEffect(() => {
    blocks.forEach((block) => {
      if (block.exerciseId && block.historyStatus === 'idle') void updateProgression(block.key, block.exerciseId);
    });
  }, [blocks, updateProgression]);

  const completedFeedbackByKey = useMemo(() => {
    const feedback = new Map<string, CompletedExerciseVolumeFeedback>();
    for (const block of blocks) {
      const startedSets = block.sets.filter((set) => !isRowEmpty(set));
      if (!startedSets.length || startedSets.some((set) => !set.completed) || block.baselineSessions == null) continue;
      const exercise = catalog?.find((item) => item.id === block.exerciseId);
      if (!exercise) continue;
      feedback.set(block.key, buildCompletedExerciseVolumeFeedback({
        currentSets: draftSetsForProgression(block.sets, unit),
        baselineSessions: block.baselineSessions,
        repMin: exercise.targetRepMin,
        repMax: exercise.targetRepMax,
        loadIncrement: unit === 'lb' ? Math.max(5, exercise.loadIncrement) : exercise.loadIncrement,
        jointFlag: jointProgressionHold,
      }));
    }
    return feedback;
  }, [blocks, catalog, jointProgressionHold, unit]);

  const completedBlockCount = blocks.filter((block) => {
    const startedSets = block.sets.filter((set) => !isRowEmpty(set));
    return startedSets.length > 0 && startedSets.every((set) => set.completed);
  }).length;

  function completeSets(blockKey: string) {
    const block = blocks.find((item) => item.key === blockKey);
    const exercise = catalog?.find((item) => item.id === block?.exerciseId);
    if (!block || !exercise) {
      setFormError('Choose an exercise before completing its sets.');
      return;
    }
    const startedRows = block.sets
      .map((set, index) => ({ set, index }))
      .filter(({ set }) => !isRowEmpty(set));
    if (startedRows.length === 0) {
      setFormError(`${exercise.name}: enter at least one set before completing it.`);
      return;
    }
    for (const { set, index } of startedRows) {
      if (!set.load.trim() || !set.reps.trim()) {
        setFormError(`${exercise.name}, set ${index + 1}: enter both load and reps.`);
        return;
      }
      const load = Number(set.load);
      const reps = Number(set.reps);
      const rpe = set.rpe.trim() ? Number(set.rpe) : null;
      if (!Number.isFinite(load) || load < 0 || !Number.isInteger(reps) || reps <= 0
        || (rpe != null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10))) {
        setFormError(`${exercise.name}, set ${index + 1}: use a non-negative load, whole-number reps, and optional RPE from 1–10.`);
        return;
      }
    }
    setFormError(null);
    setBlocks((current) => current.map((item) => item.key === blockKey ? {
      ...item,
      sets: item.sets.map((set) => isRowEmpty(set) ? set : { ...set, completed: true }),
    } : item));
    if (restTimerSeconds > 0) setRestEndsAt(Date.now() + restTimerSeconds * 1_000);
  }

  function toggleSetCompleted(blockKey: string, setKey: string) {
    const block = blocks.find((item) => item.key === blockKey);
    const set = block?.sets.find((item) => item.key === setKey);
    const exercise = catalog?.find((item) => item.id === block?.exerciseId);
    if (!block || !set || !exercise) return;
    if (!set.completed) {
      const rowNumber = block.sets.findIndex((item) => item.key === setKey) + 1;
      const error = validateDraftSet(set, `${exercise.name}, set ${rowNumber}`);
      if (error) {
        setFormError(error);
        return;
      }
    }
    setFormError(null);
    setBlocks((current) => current.map((item) => item.key === blockKey ? {
      ...item,
      sets: item.sets.map((row) => row.key === setKey ? { ...row, completed: !row.completed } : row),
    } : item));
    if (set.completed) {
      setRestEndsAt(null);
    } else if (restTimerSeconds > 0) {
      setRestEndsAt(Date.now() + restTimerSeconds * 1_000);
    }
  }

  function setSetKind(blockKey: string, setKey: string, kind: SetKind) {
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      sets: block.sets.map((set) => set.key === setKey ? { ...set, kind, completed: false } : set),
    } : block));
  }

  function removeSet(blockKey: string, setKey: string) {
    setBlocks((current) => current.map((block) => block.key === blockKey
      ? { ...block, sets: block.sets.filter((set) => set.key !== setKey) }
      : block));
  }

  function removeExercise(blockKey: string) {
    setBlocks((current) => current.filter((block) => block.key !== blockKey));
  }

  function changeUnit(nextUnit: LoadUnit) {
    if (nextUnit === unit) return;
    setBlocks((current) => current.map((block) => ({
      ...block,
      progression: null,
      historyStatus: 'idle',
      historyRequestId: null,
    })));
    setUnit(nextUnit);
  }

  const setExercise = (blockKey: string, exerciseId: string) => {
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      exerciseId,
      progression: null,
      sourceSets: null,
      baselineSessions: null,
      historyStatus: 'idle',
      historyRequestId: null,
    } : block));
    setExerciseQueries((current) => ({ ...current, [blockKey]: '' }));
    setExerciseBrowsers((current) => ({ ...current, [blockKey]: false }));
  };

  const fillFromLatestSets = (blockKey: string) => {
    setBlocks((current) => current.map((block) => {
      if (block.key !== blockKey || !block.sourceSets?.length) return block;
      const count = Math.max(block.sets.length, block.sourceSets.length);
      return {
        ...block,
        sets: Array.from({ length: count }, (_, index) => {
          const existing = block.sets[index] ?? newSet();
          const source = block.sourceSets?.[index];
          if (!source || !isRowEmpty(existing)) return existing;
          return prefillWorkoutSetFromHistory(existing, {
            load: String(convertLoadValue(source.loadValue, source.loadUnit, unit)),
            reps: String(source.reps),
            kind: source.kind,
          });
        }),
      };
    }));
  };

  const updateSet = (blockKey: string, setKey: string, field: 'load' | 'reps' | 'rpe', value: string) => {
    setFormError(null);
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      sets: block.sets.map((set) => set.key === setKey ? { ...set, [field]: value, completed: false } : set),
    } : block));
  };

  const addSet = (blockKey: string) => {
    setFormError(null);
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      sets: [...block.sets, newSet(latestValidWorkoutLoad(block.sets) ?? '')],
    } : block));
  };

  const fillBlankLoads = (blockKey: string) => {
    setFormError(null);
    setBlocks((current) => current.map((block) => {
      if (block.key !== blockKey) return block;
      const filled = fillBlankWorkoutLoads(block.sets);
      return filled.filledCount ? { ...block, sets: filled.sets } : block;
    }));
  };

  const applySetCue = (blockKey: string, cue: SetProgressionCue) => {
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      sets: block.sets.map((set, index) => workingSetIndexAt(block.sets, index) === cue.workingSetIndex ? {
        ...set,
        load: String(cue.loadValue),
        reps: String(cue.targetReps),
        rpe: '',
        completed: false,
      } : set),
    } : block));
  };

  const addExercise = () => {
    const unused = catalog?.find((exercise) => !blocks.some((block) => block.exerciseId === exercise.id));
    if (!unused) return;
    setBlocks((current) => [...current, newBlock(unused.id)]);
  };

  const addCustomExercise = async () => {
    const name = customName.trim();
    if (!name) {
      setFormError('Give your custom exercise a name.');
      return;
    }
    setCustomSaving(true);
    setFormError(null);
    try {
      const exercise = await createCustomExercise(db, {
        name,
        movementPattern: `custom_${customMuscle}`,
        primaryMuscleGroup: customMuscle,
        secondaryMuscleGroups: customSecondaryMuscles,
        equipment: 'custom',
        targetRepMin: 8,
        targetRepMax: 12,
        loadIncrement: unit === 'kg' ? 2.5 : 5,
        notes: customNotes.trim() || undefined,
      });
      setCatalog((current) => [exercise, ...(current ?? [])]);
      setBlocks((current) => {
        const last = current.at(-1);
        if (last && last.sets.every(isRowEmpty)) {
          return current.map((block) => block.key === last.key ? {
            ...block,
            exerciseId: exercise.id,
            progression: null,
            sourceSets: null,
            baselineSessions: null,
            historyStatus: 'idle',
            historyRequestId: null,
          } : block);
        }
        return [...current, newBlock(exercise.id)];
      });
      setCustomName('');
      setCustomNotes('');
      setCustomSecondaryMuscles([]);
      setCustomOpen(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not add that exercise.');
    } finally {
      setCustomSaving(false);
    }
  };

  const submit = async () => {
    if (!catalog || submitLockRef.current) return;
    submitLockRef.current = true;
    let saved = false;
    setSaving(true);
    setFormError(null);
    try {
      const exercises = blocks.flatMap((block) => {
        const startedRows = block.sets.filter((set) => !isRowEmpty(set));
        if (startedRows.length === 0) return [];
        const exercise = catalog.find((item) => item.id === block.exerciseId);
        if (!exercise) throw new Error('Choose an exercise for every completed set.');
        const unfinishedIndex = block.sets.findIndex((set) => !isRowEmpty(set) && !set.completed);
        if (unfinishedIndex >= 0) {
          throw new Error(`${exercise.name}, set ${unfinishedIndex + 1}: mark the set complete or clear the row.`);
        }
        const completedRows = startedRows.filter((set) => set.completed);
        const sets = completedRows.map((set, index) => {
          if (!set.load.trim() || !set.reps.trim()) {
            throw new Error(`${exercise.name}, set ${index + 1}: enter both load and reps.`);
          }
          return {
            id: set.id,
            loadValue: Number(set.load),
            reps: Number(set.reps),
            rpe: set.rpe.trim() ? Number(set.rpe) : null,
            loadUnit: unit,
            kind: set.kind,
          };
        });
        return [{ exercise, sets }];
      });
      if (exercises.length === 0) throw new Error('Complete at least one set before saving.');
      if (exercises.some((entry) => entry.sets.some((set) =>
        !Number.isFinite(set.loadValue)
        || set.loadValue < 0
        || !Number.isInteger(set.reps)
        || set.reps <= 0
        || (set.rpe != null && (!Number.isFinite(set.rpe) || set.rpe < 1 || set.rpe > 10))
      ))) {
        throw new Error('Use a non-negative load, whole-number reps, and optional RPE from 1–10.');
      }
      const startedAt = editWorkoutId && editStartedAt
        ? editStartedAt
        : planWorkoutId ? new Date().toISOString() : date ? localTimestampForDate(date) : new Date().toISOString();
      const recoveryDraftKey = draftOwnerUserId
        ? workoutDraftStorageKey(draftOwnerUserId, draftContext)
        : undefined;
      draftPersistenceActiveRef.current = false;
      const id = editWorkoutId
        ? await updateWorkout(db, editWorkoutId, { id: workoutIdRef.current, recoveryDraftKey, title, startedAt, exercises })
        : planWorkoutId
        ? await completePlannedWorkout(db, planWorkoutId, { id: workoutIdRef.current, recoveryDraftKey, title, startedAt, exercises })
        : await saveWorkout(db, { id: workoutIdRef.current, recoveryDraftKey, title, startedAt, exercises });
      saved = true;
      if (process.env.EXPO_OS === 'web' && draftOwnerUserId) {
        globalThis.localStorage?.removeItem(workoutDraftStorageKey(draftOwnerUserId, draftContext));
        globalThis.localStorage?.removeItem(legacyWorkoutDraftStorageKey(draftOwnerUserId, draftContext));
      }
      router.replace({ pathname: '/workouts/[id]', params: { id } });
    } catch (cause) {
      draftPersistenceActiveRef.current = true;
      const message = cause instanceof Error ? cause.message : 'Please check the sets and try again.';
      setFormError(message);
      if (process.env.EXPO_OS !== 'web') Alert.alert('Workout not saved', message);
    } finally {
      if (!saved) submitLockRef.current = false;
      setSaving(false);
    }
  };

  if (!catalog && !loadError) return <Screen><StatePanel title="Preparing your exercise list" body="Loading the on-device catalog." loading /></Screen>;
  if (loadError) return <Screen><StatePanel title="Exercise list unavailable" body={loadError} actionLabel="Try again" onAction={() => void loadCatalog()} /></Screen>;

  const commonExercises = catalog?.slice(0, COMMON_EXERCISE_COUNT) ?? [];

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      {date ? <Card style={{ backgroundColor: colors.surfaceMuted }}><AppText>Logging for <AppText style={{ fontWeight: '800' }}>{formatShortDate(`${date}T12:00:00`)}</AppText></AppText></Card> : null}
      {draftRecovered ? <Card style={{ backgroundColor: colors.successSoft, borderColor: colors.success }}><AppText style={{ color: colors.success, fontWeight: '800' }}>Unfinished workout restored</AppText><AppText style={{ color: colors.textMuted }}>Set entries, completion state, set types, and the rest timer were restored from this device.</AppText></Card> : null}
      <View style={[styles.sessionFields, !compact && styles.sessionFieldsWide]}>
        <Field label="Session name" value={title} onChangeText={setTitle} returnKeyType="done" containerStyle={styles.flex} />
        <View style={styles.unitGroup}>
          <AppText style={styles.label}>Load unit</AppText>
          <View style={styles.pills}><Pill label="kg" active={unit === 'kg'} onPress={() => changeUnit('kg')} /><Pill label="lb" active={unit === 'lb'} onPress={() => changeUnit('lb')} /></View>
        </View>
      </View>

      {templateWorkoutId || planWorkoutId || editWorkoutId ? (
        <View style={[styles.templateBanner, { backgroundColor: colors.successSoft }]}>
          <AppText style={styles.suggestionTitle}>{editWorkoutId ? 'Editing completed workout' : planWorkoutId ? 'Planned workout loaded' : 'Previous workout loaded'}</AppText>
          <AppText style={{ color: colors.textMuted }}>{editWorkoutId ? 'Changes update this calendar entry and its progression totals.' : 'Set values were copied from the selected workout. Green suggestions are optional and do not change the fields.'}</AppText>
        </View>
      ) : null}

      {hasJointConsideration ? <JointProgressionChoicePanel value={jointProgressionChoice} onChange={chooseJointProgression} /> : null}

      {draftMuscleCredits.length ? (
        <Card style={{ backgroundColor: colors.surfaceMuted }}>
          <View><AppText style={styles.suggestionTitle}>This session’s muscle coverage</AppText><AppText style={{ color: colors.textMuted }}>Completed set rows count 1.0 for the primary target and 0.5 for each assisting target.</AppText></View>
          <View style={styles.sessionMuscleGrid}>
            {draftMuscleCredits.map((item) => <Pill key={item.muscleGroup} label={`${item.label} · ${formatSetCredits(item.setCredits)}`} />)}
          </View>
        </Card>
      ) : null}

      <Button
        label={showRpeGuide ? 'Hide RPE guide' : 'RPE guide'}
        onPress={() => setShowRpeGuide((visible) => !visible)}
        expanded={showRpeGuide}
        variant="quiet"
      />
      {showRpeGuide ? (
        <Card style={styles.rpeGuide}>
          <AppText style={styles.suggestionTitle}>Rate reps in reserve</AppText>
          <AppText style={{ color: colors.textMuted }}>Optional. Estimate clean reps still possible with the same form, not pain or breathlessness.</AppText>
          <View style={styles.rpeScale}>
            <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>6</AppText> · 4+ reps left</AppText>
            <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>7</AppText> · 3 left</AppText>
            <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>8</AppText> · 2 left</AppText>
            <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>9</AppText> · 1 left</AppText>
            <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>10</AppText> · 0 clean reps left</AppText>
          </View>
        </Card>
      ) : null}

      <Card style={styles.timerCard}>
        <View style={styles.timerHeader}>
          <View style={styles.flex}>
            <AppText style={styles.suggestionTitle}>Rest timer</AppText>
            <AppText style={{ color: colors.textMuted }}>Starts when a set is marked complete. It does not affect saved training data.</AppText>
          </View>
          {restEndsAt != null ? (
            <View accessibilityLiveRegion="polite" style={[styles.timerValue, { backgroundColor: colors.accentSoft }]}>
              <AppText style={styles.timerDigits}>{formatRestTime(Math.max(0, Math.ceil((restEndsAt - timerNow) / 1_000)))}</AppText>
              <Button label="Stop" onPress={() => setRestEndsAt(null)} variant="quiet" />
            </View>
          ) : null}
        </View>
        <View style={styles.pills}>
          {[0, 60, 90, 120, 180].map((seconds) => (
            <Pill
              key={seconds}
              label={formatRestOption(seconds)}
              active={restTimerSeconds === seconds}
              onPress={() => {
                setRestTimerSeconds(seconds);
                if (seconds === 0) setRestEndsAt(null);
              }}
            />
          ))}
        </View>
      </Card>

      {formError ? <View accessibilityRole="alert" style={[styles.errorBanner, { backgroundColor: colors.dangerSoft }]}><AppText style={{ color: colors.danger }}>{formError}</AppText></View> : null}

      {blocks.map((block, blockIndex) => {
        const selected = catalog?.find((exercise) => exercise.id === block.exerciseId);
        const query = exerciseQueries[block.key]?.trim().toLocaleLowerCase() ?? '';
        const browserOpen = exerciseBrowsers[block.key] ?? false;
        const matchingResults = query || browserOpen
          ? filterExerciseCatalog(catalog ?? [], { query })
          : [];
        const results = matchingResults.slice(0, 40);
        const loadFill = fillBlankWorkoutLoads(block.sets);
        const latestLoad = latestValidWorkoutLoad(block.sets);
        const startedSets = block.sets.filter((set) => !isRowEmpty(set));
        const setsComplete = startedSets.length > 0 && startedSets.every((set) => set.completed);
        const completionFeedback = completedFeedbackByKey.get(block.key) ?? null;
        const recentBaseline = calculateRecentExerciseBaseline(block.baselineSessions ?? []);
        return (
          <Card key={block.key} style={styles.exerciseCard}>
            <View style={styles.blockHeader}>
              <View style={styles.flex}><AppText style={styles.blockNumber}>EXERCISE {blockIndex + 1}</AppText><AppText style={styles.exerciseName}>{selected?.name ?? 'Choose exercise'}</AppText></View>
              <View style={styles.blockHeaderActions}>
                {setsComplete ? <Pill label="Sets checked" active /> : null}
                {blocks.length > 1 ? <Button label="Remove" onPress={() => removeExercise(block.key)} variant="quiet" /> : null}
              </View>
            </View>

            <View style={styles.pickerSection}>
              <AppText style={styles.pickerLabel}>Common exercises</AppText>
              <View style={styles.catalog}>
                {commonExercises.map((exercise) => <Pill key={exercise.id} label={exercise.name} active={exercise.id === block.exerciseId} onPress={() => setExercise(block.key, exercise.id)} />)}
              </View>
              <View style={styles.exerciseSearchHeader}>
                <Field
                  accessibilityLabel={`Find exercise for exercise ${blockIndex + 1}`}
                  placeholder="Search by exercise, muscle, or equipment"
                  value={exerciseQueries[block.key] ?? ''}
                  onChangeText={(value) => setExerciseQueries((current) => ({ ...current, [block.key]: value }))}
                  containerStyle={styles.flex}
                />
                <Button label={browserOpen ? 'Close list' : `Browse all ${catalog?.length ?? 0}`} onPress={() => setExerciseBrowsers((current) => ({ ...current, [block.key]: !browserOpen }))} variant="secondary" />
              </View>
              {query || browserOpen ? (
                <ScrollView style={[styles.exerciseResultScroll, { borderColor: colors.border }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {results.length ? results.map((exercise) => (
                    <Pressable key={exercise.id} accessibilityRole="button" onPress={() => setExercise(block.key, exercise.id)} style={({ pressed }) => [styles.exerciseResult, { borderBottomColor: colors.border }, pressed && styles.pressed]}>
                      <View style={styles.flex}><AppText style={styles.resultName}>{exercise.name}</AppText><AppText style={{ color: colors.textMuted }}>{muscleGroupLabel(exercise.primaryMuscleGroup)} · {exerciseEquipmentLabel(exercise.equipment)}</AppText></View>
                      <AppText style={{ color: exercise.id === block.exerciseId ? colors.success : colors.accent, fontWeight: '700' }}>{exercise.id === block.exerciseId ? 'Selected' : 'Choose'}</AppText>
                    </Pressable>
                  )) : <AppText style={[styles.noResult, { color: colors.textMuted }]}>No match. Add a custom exercise below.</AppText>}
                  {matchingResults.length > results.length ? <AppText style={[styles.noResult, { color: colors.textMuted }]}>Showing 40 of {matchingResults.length}. Search by name, muscle, or equipment to narrow the list.</AppText> : null}
                </ScrollView>
              ) : null}
            </View>

            {selected ? <AppText style={[styles.range, { color: colors.textMuted }]}>{muscleGroupLabel(selected.primaryMuscleGroup)} primary{selected.secondaryMuscleGroups.length ? ` · ${selected.secondaryMuscleGroups.map(muscleGroupLabel).join(', ')} assist` : ''} · target {selected.targetRepMin}–{selected.targetRepMax} reps{selected.notes ? ` · ${selected.notes}` : ''}</AppText> : null}
            {block.progression ? (
              <View style={[styles.suggestion, { backgroundColor: block.progression.action === 'hold' ? colors.warningSoft : colors.successSoft }]}>
                <View style={styles.suggestionCopy}>
                  <AppText style={[styles.suggestionTitle, { color: block.progression.action === 'hold' ? colors.warning : colors.success }]}>{block.progression.action === 'hold' ? 'Repeat before increasing' : 'Progression suggestion'}</AppText>
                  <AppText style={styles.suggestionText}>{block.progression.reason}</AppText>
                  {recentBaseline.volumeKg != null ? (
                    <AppText style={{ color: colors.textMuted }}>
                      Recent baseline · {formatDraftWork(recentBaseline.volumeKg)} kg·reps median across {recentBaseline.sessionCount} matching session{recentBaseline.sessionCount === 1 ? '' : 's'}
                    </AppText>
                  ) : <AppText style={{ color: colors.textMuted }}>No matching session yet. Today will establish this exercise’s baseline.</AppText>}
                </View>
                {block.sourceSets?.length && block.sets.some(isRowEmpty) ? <Button label="Fill from latest" onPress={() => fillFromLatestSets(block.key)} variant="quiet" /> : null}
              </View>
            ) : null}

            {!compact ? <View style={styles.setTable}>
              <View style={styles.setLabels}>
                <AppText style={styles.setNo}>Set</AppText>
                <AppText style={styles.setInputLabel}>Load ({unit})</AppText>
                <AppText style={styles.setInputLabel}>Reps</AppText>
                <AppText style={styles.setInputLabel}>RPE</AppText>
                <AppText style={styles.setDoneLabel}>Done</AppText>
                <View style={styles.removeColumn} />
              </View>
              {block.sets.map((set, setIndex) => (
                <View key={set.key} style={styles.setRowGroup}>
                  <View style={styles.setRow}>
                    <AppText style={styles.setNo}>{setIndex + 1}</AppText>
                    <Field accessibilityLabel={`Set ${setIndex + 1} load in ${unit}`} value={set.load} onChangeText={(value) => updateSet(block.key, set.key, 'load', value)} keyboardType="decimal-pad" style={styles.compactInput} containerStyle={styles.setField} />
                    <Field accessibilityLabel={`Set ${setIndex + 1} reps`} value={set.reps} onChangeText={(value) => updateSet(block.key, set.key, 'reps', value)} keyboardType="number-pad" style={styles.compactInput} containerStyle={styles.setField} />
                    <Field accessibilityLabel={`Set ${setIndex + 1} RPE`} value={set.rpe} placeholder="—" onChangeText={(value) => updateSet(block.key, set.key, 'rpe', value)} keyboardType="decimal-pad" style={styles.compactInput} containerStyle={styles.setField} />
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${set.completed ? 'Undo' : 'Complete'} set ${setIndex + 1} for ${selected?.name ?? 'exercise'}`}
                      accessibilityState={{ checked: set.completed }}
                      onPress={() => toggleSetCompleted(block.key, set.key)}
                      style={({ pressed }) => [styles.setDone, { backgroundColor: set.completed ? colors.successSoft : colors.surfaceRaised, borderColor: set.completed ? colors.success : colors.border }, pressed && styles.pressed]}
                    ><AppText style={{ color: set.completed ? colors.success : colors.textMuted, fontWeight: '800' }}>{set.completed ? '✓' : '○'}</AppText></Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove set ${setIndex + 1}`}
                      disabled={block.sets.length === 1}
                      onPress={() => removeSet(block.key, set.key)}
                      style={({ pressed }) => [styles.removeSet, { borderColor: colors.border }, pressed && styles.pressed, block.sets.length === 1 && styles.disabled]}
                    ><AppText style={{ color: colors.textMuted }}>×</AppText></Pressable>
                  </View>
                  <SetKindPicker value={set.kind} onChange={(kind) => setSetKind(block.key, set.key, kind)} />
                  {progressionCueForRow(block.progression, block.sets, setIndex) ? (
                    <SetCueRow cue={progressionCueForRow(block.progression, block.sets, setIndex)!} onApply={(cue) => applySetCue(block.key, cue)} />
                  ) : null}
                </View>
              ))}
            </View> : (
              <View style={styles.mobileSetList}>
                {block.sets.map((set, setIndex) => (
                  <View key={set.key} style={[styles.mobileSetCard, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                    <View style={styles.mobileSetHeader}><AppText style={styles.suggestionTitle}>Set {setIndex + 1} · {set.kind === 'warmup' ? 'Warm-up' : set.kind === 'working' ? 'Working' : set.kind === 'drop' ? 'Drop' : 'Failure'}</AppText><Pressable accessibilityRole="button" accessibilityLabel={`Remove set ${setIndex + 1}`} disabled={block.sets.length === 1} onPress={() => removeSet(block.key, set.key)} style={({ pressed }) => [styles.mobileRemove, pressed && styles.pressed, block.sets.length === 1 && styles.disabled]}><AppText style={{ color: colors.textMuted }}>Remove</AppText></Pressable></View>
                    <View style={styles.mobileSetFields}>
                      <Field label={`Load (${unit})`} value={set.load} onChangeText={(value) => updateSet(block.key, set.key, 'load', value)} keyboardType="decimal-pad" containerStyle={styles.mobileSetField} />
                      <Field label="Reps" value={set.reps} onChangeText={(value) => updateSet(block.key, set.key, 'reps', value)} keyboardType="number-pad" containerStyle={styles.mobileSetField} />
                      <Field label="RPE" value={set.rpe} placeholder="optional" onChangeText={(value) => updateSet(block.key, set.key, 'rpe', value)} keyboardType="decimal-pad" containerStyle={styles.mobileSetField} />
                    </View>
                    <SetKindPicker value={set.kind} onChange={(kind) => setSetKind(block.key, set.key, kind)} />
                    <Button label={set.completed ? 'Undo completed set' : 'Mark set complete'} onPress={() => toggleSetCompleted(block.key, set.key)} variant={set.completed ? 'quiet' : 'secondary'} />
                    {progressionCueForRow(block.progression, block.sets, setIndex) ? (
                      <SetCueRow cue={progressionCueForRow(block.progression, block.sets, setIndex)!} onApply={(cue) => applySetCue(block.key, cue)} />
                    ) : null}
                  </View>
                ))}
              </View>
            )}
            <View style={styles.setActions}>
              <Button label="Add set" onPress={() => addSet(block.key)} variant="secondary" />
              {loadFill.filledCount > 0 ? <Button label={`Fill ${loadFill.filledCount} blank load${loadFill.filledCount === 1 ? '' : 's'}`} onPress={() => fillBlankLoads(block.key)} variant="quiet" /> : null}
              <AppText style={[styles.setActionNote, { color: colors.textMuted }]}>{latestLoad
                ? `A new set reuses ${latestLoad} ${unit}; reps and RPE stay blank.`
                : 'Enter one load to unlock quick fill. Existing loads are never overwritten.'}</AppText>
            </View>
            <View style={[styles.completeSets, { borderTopColor: colors.border }]}>
              <View style={styles.completeSetsCopy}>
                <AppText style={styles.suggestionTitle}>Review completed sets</AppText>
                <AppText style={{ color: colors.textMuted }}>Marks every valid entered row complete, then compares working sets with the recent matching baseline.</AppText>
              </View>
              <Button
                label={setsComplete ? 'Check again' : 'Complete sets'}
                accessibilityLabel={`${setsComplete ? 'Check again' : 'Complete sets'} for ${selected?.name ?? `exercise ${blockIndex + 1}`}`}
                onPress={() => completeSets(block.key)}
                variant="secondary"
              />
            </View>
            {setsComplete && block.historyStatus === 'error' ? (
              <View accessibilityRole="alert" style={[styles.completionReview, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
                <AppText style={[styles.suggestionTitle, { color: colors.warning }]}>Recent sets unavailable</AppText>
                <AppText style={styles.suggestionText}>Your entries have not changed. Retry the history check before using a progression suggestion.</AppText>
                <View style={styles.historyRetryAction}>
                  <Button label="Retry history" onPress={() => void updateProgression(block.key, block.exerciseId)} variant="secondary" />
                </View>
              </View>
            ) : setsComplete && !completionFeedback ? (
              <View accessibilityLiveRegion="polite" style={[styles.completionReview, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
                <AppText style={styles.suggestionTitle}>Reviewing recent history…</AppText>
              </View>
            ) : completionFeedback ? (
              <View
                accessibilityLiveRegion="polite"
                style={[
                  styles.completionReview,
                  {
                    backgroundColor: completionFeedback.status === 'hold'
                      ? colors.warningSoft
                      : completionFeedback.status === 'progress'
                        ? colors.accentSoft
                        : colors.successSoft,
                    borderColor: completionFeedback.status === 'hold'
                      ? colors.warning
                      : completionFeedback.status === 'progress'
                        ? colors.accent
                        : colors.success,
                  },
                ]}
              >
                <View style={styles.completionHeader}>
                  <View style={styles.flex}>
                    <AppText style={styles.completionEyebrow}>5% VOLUME GUIDE</AppText>
                    <AppText style={styles.completionTitle}>{completionTitle(completionFeedback)}</AppText>
                  </View>
                  <Pill label="Sets checked" active />
                </View>
                <View style={styles.completionMetrics}>
                  <VolumeMetric label={`Recent median (${completionFeedback.baselineSessionCount})`} value={completionFeedback.baselineVolumeKg} />
                  <VolumeMetric label="Today" value={completionFeedback.currentVolumeKg} />
                  <View style={styles.completionMetric}>
                    <AppText style={styles.completionValue}>{formatVolumeChange(completionFeedback.changePercent)}</AppText>
                    <AppText style={{ color: colors.textMuted }}>change</AppText>
                  </View>
                </View>
                <AppText style={{ color: colors.textMuted }}>{completionFeedback.reason}</AppText>
                {completionFeedback.cues.length ? (
                  <View style={[styles.nextExposure, { borderColor: colors.border }]}>
                    <AppText style={styles.suggestionTitle}>Next time</AppText>
                    <AppText>{formatCompletionCues(completionFeedback.cues)}</AppText>
                    {completionFeedback.projectedChangePercent != null ? (
                      <AppText style={{ color: colors.textMuted }}>Projected volume: {formatVolumeChange(completionFeedback.projectedChangePercent)} vs recent baseline. The 5% figure is a guide, not a forced jump.</AppText>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      <Button label="Add another exercise" onPress={addExercise} variant="secondary" disabled={!catalog?.some((exercise) => !blocks.some((block) => block.exerciseId === exercise.id))} />

      <Card>
        <View style={styles.customHeader}>
          <View style={styles.flex}><AppText style={styles.exerciseName}>Custom exercise</AppText><AppText style={{ color: colors.textMuted }}>Add an exercise to use in this and future workouts.</AppText></View>
          <Button label={customOpen ? 'Close' : 'Add custom'} onPress={() => setCustomOpen((value) => !value)} variant="quiet" />
        </View>
        {customOpen ? (
          <View style={styles.customForm}>
            <Field label="Exercise name" placeholder="e.g. Cable high row" value={customName} onChangeText={setCustomName} autoFocus />
            <Field label="Short description (optional)" placeholder="Machine, grip, setup, or cue" value={customNotes} onChangeText={setCustomNotes} multiline />
            <View style={styles.customForm}>
              <View><AppText style={styles.label}>Primary muscle</AppText><AppText style={{ color: colors.textMuted }}>Gets one full working-set credit in the body-part dashboard.</AppText></View>
              {MUSCLE_GROUP_SECTIONS.map((section) => <View key={section} style={styles.muscleSection}><AppText style={[styles.muscleSectionLabel, { color: colors.textMuted }]}>{section}</AppText><View style={styles.searchResults}>{MUSCLE_GROUP_OPTIONS.filter((group) => group.section === section).map((group) => <Pill key={group.value} label={group.label} active={customMuscle === group.value} onPress={() => { setCustomMuscle(group.value); setCustomSecondaryMuscles((current) => current.filter((item) => item !== group.value)); }} />)}</View></View>)}
            </View>
            <View style={styles.customForm}>
              <View><AppText style={styles.label}>Secondary muscles (optional)</AppText><AppText style={{ color: colors.textMuted }}>Each selected assisting muscle gets half-set credit.</AppText></View>
              {MUSCLE_GROUP_SECTIONS.map((section) => <View key={section} style={styles.muscleSection}><AppText style={[styles.muscleSectionLabel, { color: colors.textMuted }]}>{section}</AppText><View style={styles.searchResults}>{MUSCLE_GROUP_OPTIONS.filter((group) => group.section === section && group.value !== customMuscle).map((group) => <Pill key={group.value} label={group.label} active={customSecondaryMuscles.includes(group.value)} onPress={() => setCustomSecondaryMuscles((current) => current.includes(group.value) ? current.filter((item) => item !== group.value) : [...current, group.value])} />)}</View></View>)}
            </View>
            <Button label="Save and use exercise" onPress={() => void addCustomExercise()} busy={customSaving} />
          </View>
        ) : null}
      </Card>

      <SectionHeading title="Finish" detail={editWorkoutId ? 'Removed sets are removed from progression totals; new sets are added to this same session.' : planWorkoutId ? 'Completing this session replaces the calendar plan with the work you actually did.' : 'Review exactly what will be saved to this device first.'} />
      <Card style={{ backgroundColor: draftSummary.needsAttentionCount ? colors.warningSoft : colors.surfaceMuted, borderColor: draftSummary.needsAttentionCount ? colors.warning : colors.border }}>
        <View style={styles.draftSummaryHeader}>
          <View style={styles.flex}>
            <AppText style={styles.suggestionTitle}>{draftSummary.needsAttentionCount
              ? `${draftSummary.needsAttentionCount} set row${draftSummary.needsAttentionCount === 1 ? '' : 's'} need attention`
              : draftSummary.completedSetCount ? 'Workout ready to save' : 'No completed sets'}</AppText>
            <AppText style={{ color: colors.textMuted }}>{draftSummary.needsAttentionCount
              ? 'Every started row needs a valid load and whole-number reps. RPE is optional from 1–10.'
              : `${draftSummary.blankSetCount} blank row${draftSummary.blankSetCount === 1 ? '' : 's'} will be ignored.`}</AppText>
          </View>
        </View>
        <View style={styles.draftSummaryMetrics}>
          <View style={styles.draftSummaryMetric}><AppText style={styles.draftSummaryValue}>{draftSummary.completedSetCount}</AppText><AppText style={{ color: colors.textMuted }}>sets ready</AppText></View>
          <View style={styles.draftSummaryMetric}><AppText style={styles.draftSummaryValue}>{formatDraftWork(draftSummary.work)}</AppText><AppText style={{ color: colors.textMuted }}>{unit}·reps work</AppText></View>
          <View style={styles.draftSummaryMetric}><AppText style={styles.draftSummaryValue}>{completedBlockCount}/{blocks.length}</AppText><AppText style={{ color: colors.textMuted }}>exercises checked</AppText></View>
        </View>
      </Card>
      <Button label={editWorkoutId ? 'Save workout changes' : planWorkoutId ? 'Complete planned workout' : 'Save completed workout'} onPress={() => void submit()} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { width: '100%', maxWidth: 980, alignSelf: 'center' },
  sessionFields: { gap: spacing.md },
  sessionFieldsWide: { flexDirection: 'row', alignItems: 'flex-end' },
  unitGroup: { gap: spacing.xs },
  label: { fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  flex: { flex: 1 },
  errorBanner: { padding: spacing.md, borderRadius: radii.control },
  templateBanner: { padding: spacing.md, borderRadius: radii.control, gap: spacing.xxs },
  rpeGuide: { gap: spacing.sm },
  rpeScale: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rpeItem: { ...typography.label },
  rpeNumber: { fontWeight: '800' },
  timerCard: { gap: spacing.sm },
  timerHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  timerValue: { minHeight: 48, borderRadius: radii.control, paddingLeft: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  timerDigits: { ...typography.section, minWidth: 64, fontWeight: '800', fontVariant: ['tabular-nums'] },
  exerciseCard: { paddingHorizontal: 0, overflow: 'hidden' },
  blockHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  blockHeaderActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.xs },
  blockNumber: { ...typography.caption, fontWeight: '700', opacity: 0.65 },
  exerciseName: { ...typography.section, fontWeight: '700' },
  pickerSection: { gap: spacing.sm, paddingHorizontal: spacing.md },
  pickerLabel: { ...typography.label, fontWeight: '700' },
  catalog: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  exerciseSearchHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.sm },
  exerciseResultScroll: { maxHeight: 288, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control },
  exerciseResult: { minHeight: 58, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  resultName: { fontWeight: '700' },
  noResult: { padding: spacing.md },
  searchResults: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  muscleSection: { gap: spacing.xs },
  muscleSectionLabel: { ...typography.caption, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  range: { paddingHorizontal: spacing.md },
  suggestion: { marginHorizontal: spacing.md, padding: spacing.sm, borderRadius: radii.control, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestionCopy: { flex: 1, gap: spacing.xxs },
  suggestionTitle: { ...typography.label, fontWeight: '700' },
  suggestionText: { ...typography.label },
  setTable: { paddingHorizontal: spacing.md, gap: spacing.xs },
  setLabels: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  setRowGroup: { gap: spacing.xxs },
  setRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  setNo: { flexBasis: 40, flexGrow: 0, flexShrink: 0, textAlign: 'center', ...typography.label, fontWeight: '700' },
  setInputLabel: { flex: 1, minWidth: 0, textAlign: 'center', ...typography.caption, fontWeight: '700', opacity: 0.7 },
  setDoneLabel: { width: 44, textAlign: 'center', ...typography.caption, fontWeight: '700', opacity: 0.7 },
  setField: { flex: 1, minWidth: 0 },
  compactInput: { textAlign: 'center', paddingHorizontal: spacing.xs },
  setCue: { marginLeft: 48, paddingLeft: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  setCueCopy: { flex: 1, ...typography.caption, fontWeight: '700' },
  removeColumn: { width: 44 },
  setDone: { width: 44, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center' },
  removeSet: { width: 44, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center' },
  setKindPicker: { marginLeft: 48, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  setActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  setActionNote: { ...typography.caption, flexGrow: 1, flexBasis: 220 },
  completeSets: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  completeSetsCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 280, gap: spacing.xxs },
  completionReview: { marginHorizontal: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, gap: spacing.sm },
  historyRetryAction: { alignItems: 'flex-start' },
  completionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  completionEyebrow: { ...typography.caption, fontWeight: '800', letterSpacing: 0.7, opacity: 0.68 },
  completionTitle: { ...typography.section, fontWeight: '800' },
  completionMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  completionMetric: { flexGrow: 1, flexBasis: 120 },
  completionValue: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  nextExposure: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, gap: spacing.xxs },
  draftSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  draftSummaryMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  draftSummaryMetric: { flexGrow: 1, flexBasis: 160 },
  draftSummaryValue: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sessionMuscleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  mobileSetList: { paddingHorizontal: spacing.md, gap: spacing.sm },
  mobileSetCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.sm, gap: spacing.sm },
  mobileSetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mobileSetFields: { flexDirection: 'row', gap: spacing.xs },
  mobileSetField: { flex: 1, minWidth: 0 },
  mobileRemove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  customHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  customForm: { gap: spacing.md },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.35 },
});

function formatDraftWork(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString();
}

function summarizeDraftMuscleCredits(blocks: DraftExercise[], catalog: Exercise[]) {
  const credits = new Map<string, number>();
  for (const block of blocks) {
    const exercise = catalog.find((item) => item.id === block.exerciseId);
    if (!exercise) continue;
    const completedSetCount = block.sets.filter((set) => {
      if (!set.completed || set.kind !== 'working') return false;
      if (isRowEmpty(set)) return false;
      const load = Number(set.load);
      const reps = Number(set.reps);
      return Number.isFinite(load) && load >= 0 && Number.isInteger(reps) && reps > 0;
    }).length;
    if (completedSetCount === 0) continue;
    const primary = muscleGroupFamilyKey(exercise.primaryMuscleGroup);
    const secondary = [...new Set(exercise.secondaryMuscleGroups.map(muscleGroupFamilyKey))]
      .filter((group) => group !== primary);
    credits.set(primary, (credits.get(primary) ?? 0) + completedSetCount);
    for (const group of secondary) credits.set(group, (credits.get(group) ?? 0) + completedSetCount * 0.5);
  }
  return [...credits.entries()]
    .map(([muscleGroup, setCredits]) => ({ muscleGroup, label: muscleGroupFamilyLabel(muscleGroup), setCredits }))
    .sort((a, b) => b.setCredits - a.setCredits || a.label.localeCompare(b.label));
}

function formatSetCredits(value: number): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${formatted} set credit${value === 1 ? '' : 's'}`;
}

function draftSetsForProgression(sets: DraftSet[], unit: LoadUnit): ProgressionSet[] {
  return sets.filter((set) => set.completed && set.kind === 'working' && !isRowEmpty(set)).map((set) => ({
    loadValue: Number(set.load),
    loadUnit: unit,
    reps: Number(set.reps),
    rpe: set.rpe.trim() ? Number(set.rpe) : null,
    kind: set.kind,
  }));
}

function completionTitle(feedback: CompletedExerciseVolumeFeedback): string {
  if (feedback.status === 'baseline') return 'Baseline established';
  if (feedback.status === 'target_reached') return 'Guide reached';
  if (feedback.status === 'hold') return 'Hold here';
  return 'Progression available';
}

function formatVolumeChange(value: number | null): string {
  if (value == null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString()}%`;
}

function formatCompletionCues(cues: SetProgressionCue[]): string {
  if (cues.length === 1) {
    const cue = cues[0]!;
    return `Set ${cue.workingSetIndex + 1} · ${cue.label.replace(/^Try /, '')}`;
  }
  const first = cues[0];
  if (first && cues.every((cue) => cue.loadValue === first.loadValue && cue.targetReps === first.targetReps)) {
    return `All ${cues.length} sets · ${first.label.replace(/^Try /, '')}`;
  }
  return cues.map((cue) => `Set ${cue.workingSetIndex + 1}: ${cue.label.replace(/^Try /, '')}`).join(' · ');
}

function VolumeMetric({ label, value }: { label: string; value: number | null }) {
  const { colors } = useJienTheme();
  return (
    <View style={styles.completionMetric}>
      <AppText style={styles.completionValue}>{value == null ? '—' : formatDraftWork(value)}</AppText>
      <AppText style={{ color: colors.textMuted }}>{label.toLocaleLowerCase()} kg·reps</AppText>
    </View>
  );
}

function blocksFromTemplate(template: WorkoutDetail): DraftExercise[] {
  const grouped = new Map<string, DraftExercise>();
  template.sets.forEach((set) => {
    const block = grouped.get(set.exerciseId) ?? {
      key: Crypto.randomUUID(),
      exerciseId: set.exerciseId,
      sets: [],
      progression: null,
      sourceSets: [],
      baselineSessions: null,
      historyStatus: 'idle',
      historyRequestId: null,
    };
    block.sets.push(newSet(String(set.loadValue), String(set.reps), '', undefined, set.kind, false));
    if (set.kind === 'working') {
      block.sourceSets?.push({
        loadValue: set.loadValue,
        loadUnit: set.loadUnit,
        reps: set.reps,
        rpe: set.rpe,
        kind: set.kind,
      });
    }
    grouped.set(set.exerciseId, block);
  });
  return [...grouped.values()];
}

function blocksFromEdit(template: WorkoutDetail): DraftExercise[] {
  const grouped = new Map<string, DraftExercise>();
  template.sets.forEach((set) => {
    const block = grouped.get(set.exerciseId) ?? {
      key: Crypto.randomUUID(), exerciseId: set.exerciseId, sets: [], progression: null, sourceSets: null, baselineSessions: null, historyStatus: 'idle', historyRequestId: null,
    };
    block.sets.push(newSet(
      String(set.loadValue), String(set.reps), set.rpe == null ? '' : String(set.rpe), set.id, set.kind, true,
    ));
    grouped.set(set.exerciseId, block);
  });
  return [...grouped.values()];
}

function blocksFromPlan(template: WorkoutDetail): DraftExercise[] {
  return template.plan?.exercises.map((exercise) => ({
    key: Crypto.randomUUID(),
    exerciseId: exercise.exerciseId,
    sets: exercise.sets.map((set) => newSet(
      set.loadValue == null ? '' : String(set.loadValue),
      set.reps == null ? '' : String(set.reps),
    )),
    progression: exercise.progression,
    sourceSets: exercise.sets.flatMap((set) => set.loadValue == null || set.reps == null ? [] : [{
      loadValue: set.loadValue,
      loadUnit: set.loadUnit,
      reps: set.reps,
      rpe: set.rpe ?? null,
      kind: 'working' as const,
    }]),
    baselineSessions: null,
    historyStatus: 'idle',
    historyRequestId: null,
  })) ?? [];
}

function SetCueRow({ cue, onApply }: { cue: SetProgressionCue; onApply: (cue: SetProgressionCue) => void }) {
  const { colors } = useJienTheme();
  return (
    <View style={styles.setCue}>
      <AppText style={[styles.setCueCopy, { color: colors.success }]}>{cue.label}</AppText>
      <Button label="Use" onPress={() => onApply(cue)} variant="quiet" />
    </View>
  );
}

function SetKindPicker({ value, onChange }: { value: SetKind; onChange: (kind: SetKind) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={styles.setKindPicker}>
      {([
        ['working', 'Working'],
        ['warmup', 'Warm-up'],
        ['drop', 'Drop'],
        ['failure', 'Failure'],
      ] as const).map(([kind, label]) => (
        <Pill key={kind} label={label} active={value === kind} onPress={() => onChange(kind)} accessibilityRole="radio" />
      ))}
    </View>
  );
}

function workingSetIndexAt(sets: DraftSet[], rowIndex: number): number {
  if (sets[rowIndex]?.kind !== 'working') return -1;
  return sets.slice(0, rowIndex).filter((set) => set.kind === 'working').length;
}

function progressionCueForRow(plan: SetProgressionPlan | null, sets: DraftSet[], rowIndex: number): SetProgressionCue | null {
  const workingSetIndex = workingSetIndexAt(sets, rowIndex);
  if (workingSetIndex < 0) return null;
  return plan?.cues.find((cue) => cue.workingSetIndex === workingSetIndex) ?? null;
}

function validateDraftSet(set: DraftSet, label: string): string | null {
  if (!set.load.trim() || !set.reps.trim()) return `${label}: enter both load and reps.`;
  const load = Number(set.load);
  const reps = Number(set.reps);
  const rpe = set.rpe.trim() ? Number(set.rpe) : null;
  if (!Number.isFinite(load) || load < 0 || !Number.isInteger(reps) || reps <= 0
    || (rpe != null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10))) {
    return `${label}: use a non-negative load, whole-number reps, and optional RPE from 1–10.`;
  }
  return null;
}

function formatRestOption(seconds: number): string {
  if (seconds === 0) return 'Off';
  if (seconds === 90) return '1 min 30 sec';
  return `${seconds / 60} min`;
}

function formatRestTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function convertLoadValue(value: number, from: LoadUnit, to: LoadUnit): number {
  if (from === to) return value;
  const converted = from === 'lb' ? value * 0.45359237 : value / 0.45359237;
  return Math.round(converted * 100) / 100;
}
