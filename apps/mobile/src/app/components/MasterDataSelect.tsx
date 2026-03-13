import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppTheme } from '../theme';
import type { MasterDataOption } from '../master-data-local';

type Props = {
  label: string;
  placeholder: string;
  value: string;
  options: MasterDataOption[];
  theme: AppTheme;
  onChange: (next: string) => void;
  disabled?: boolean;
  optional?: boolean;
};

export function MasterDataSelect({
  label,
  placeholder,
  value,
  options,
  theme,
  onChange,
  disabled = false,
  optional = false
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');

  const selected = options.find((option) => option.id === value);
  const groupOptions = useMemo(() => {
    const groups = new Set<string>();
    for (const option of options) {
      const group = option.group?.trim();
      if (group) {
        groups.add(group);
      }
    }
    return [...groups].sort((a, b) => a.localeCompare(b));
  }, [options]);

  const hasGroupFilter = groupOptions.length > 0;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return options
      .filter((option) => {
        if (hasGroupFilter && groupFilter !== 'ALL' && (option.group?.trim() ?? '') !== groupFilter) {
          return false;
        }
        if (!query) {
          return true;
        }
        const content = `${option.label} ${option.subtitle ?? ''} ${option.id}`.toLowerCase();
        return content.includes(query);
      })
      .slice(0, 40);
  }, [options, search, hasGroupFilter, groupFilter]);

  useEffect(() => {
    if (!hasGroupFilter) {
      if (groupFilter !== 'ALL') {
        setGroupFilter('ALL');
      }
      return;
    }
    if (groupFilter !== 'ALL' && !groupOptions.includes(groupFilter)) {
      setGroupFilter('ALL');
    }
  }, [groupFilter, groupOptions, hasGroupFilter]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.subtext }]}>{label}</Text>
      <Pressable
        onPress={() => {
          if (!disabled) {
            setOpen((prev) => !prev);
          }
        }}
        style={[
          styles.trigger,
          {
            backgroundColor: theme.inputBg,
            borderColor: open ? theme.primary : theme.cardBorder,
            opacity: disabled ? 0.55 : 1
          }
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.triggerText, { color: selected ? theme.inputText : theme.inputPlaceholder }]}>
            {selected ? selected.label : placeholder}
          </Text>
          {selected?.subtitle ? <Text style={[styles.triggerSub, { color: theme.subtext }]}>{selected.subtitle}</Text> : null}
        </View>
        <Text style={[styles.chevron, { color: theme.subtext }]}>{open ? '▲' : '▼'}</Text>
      </Pressable>

      {open ? (
        <View style={[styles.dropdown, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search..."
            placeholderTextColor={theme.inputPlaceholder}
            style={[styles.search, { backgroundColor: theme.inputBg, color: theme.inputText }]}
          />

          {hasGroupFilter ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupRow}>
              <Pressable
                onPress={() => setGroupFilter('ALL')}
                style={[
                  styles.groupChip,
                  { backgroundColor: groupFilter === 'ALL' ? theme.primary : theme.pillBg }
                ]}
              >
                <Text style={[styles.groupChipText, { color: groupFilter === 'ALL' ? '#FFFFFF' : theme.pillText }]}>
                  All Categories
                </Text>
              </Pressable>
              {groupOptions.map((group) => {
                const selectedGroup = groupFilter === group;
                return (
                  <Pressable
                    key={group}
                    onPress={() => setGroupFilter(group)}
                    style={[
                      styles.groupChip,
                      { backgroundColor: selectedGroup ? theme.primary : theme.pillBg }
                    ]}
                  >
                    <Text style={[styles.groupChipText, { color: selectedGroup ? '#FFFFFF' : theme.pillText }]}>
                      {group}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {optional ? (
            <Pressable
              style={[styles.option, { borderBottomColor: theme.cardBorder }]}
              onPress={() => {
                onChange('');
                setOpen(false);
                setSearch('');
              }}
            >
              <Text style={[styles.optionLabel, { color: theme.inputText }]}>None</Text>
            </Pressable>
          ) : null}

          <ScrollView nestedScrollEnabled style={styles.list}>
            {filtered.length === 0 ? (
              <Text style={[styles.empty, { color: theme.subtext }]}>No records available.</Text>
            ) : (
              filtered.map((option) => {
                const active = value === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => {
                      onChange(option.id);
                      setOpen(false);
                      setSearch('');
                    }}
                    style={[
                      styles.option,
                      {
                        borderBottomColor: theme.cardBorder,
                        backgroundColor: active ? theme.pillBg : 'transparent'
                      }
                    ]}
                  >
                    <Text style={[styles.optionLabel, { color: theme.inputText }]}>{option.label}</Text>
                    {option.subtitle ? <Text style={[styles.optionSub, { color: theme.subtext }]}>{option.subtitle}</Text> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6
  },
  label: {
    fontSize: 12,
    fontWeight: '600'
  },
  trigger: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600'
  },
  triggerSub: {
    marginTop: 1,
    fontSize: 11
  },
  chevron: {
    fontSize: 11,
    fontWeight: '700'
  },
  dropdown: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    gap: 8
  },
  search: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13
  },
  list: {
    maxHeight: 180
  },
  groupRow: {
    gap: 6,
    paddingRight: 8
  },
  groupChip: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  groupChipText: {
    fontSize: 10,
    fontWeight: '700'
  },
  option: {
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 2
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '600'
  },
  optionSub: {
    fontSize: 11
  },
  empty: {
    paddingVertical: 10,
    fontSize: 12
  }
});
