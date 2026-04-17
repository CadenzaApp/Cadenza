import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { Tag } from '@/types/tag-types';

const COLOR_BOX_SIZE = 44;
const COLOR_OPTIONS: string[] = [
  '#da4a40', '#ce7129', '#e4ba25', '#73dd2c',
  '#25924f', '#26c2aa', '#1f93d6', '#3863d8',
  '#5644ce', '#963dd1', '#da34c1', '#d62f67',
];

export function CreateTagDialog({ onTagCreated }: { onTagCreated: (tag: Tag) => void }) {
  const [open, setOpen] = useState(false); // whether dialog is visible or not
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_OPTIONS[0]);
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setName('');
    setSelectedColor(COLOR_OPTIONS[0]);
  }

  function handleOpenChange(val: boolean) {
    if(!val) resetForm();
    setOpen(val);
  }

  async function handleCreate() {
    if(!name.trim()) return; // if empty

    setLoading(true);

    try {
      // TODO: persist tag to database here
      onTagCreated({ id: Date.now().toString(), name: name.trim(), color: selectedColor });
      resetForm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>

      <DialogTrigger style={styles.fab}>
        <Text style={styles.fabIcon}>+</Text>
      </DialogTrigger>

      <DialogContent style={{ flex: 0, backgroundColor: '#2d3139', borderColor: '#3d4149'}}>  
        <DialogHeader>
          <DialogTitle className="text-white">Create New Tag</DialogTitle>
          <DialogDescription style={{ color: '#bebebe' }}>Give your tag a name and a color</DialogDescription>
        </DialogHeader>

        {/* Tag name input */}
        <View style={styles.fieldText}>
          <Label className="text-white">Tag Name</Label>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="e.g. Instrumental"
            placeholderTextColor="#7c7b7b"
            returnKeyType="done"
          />
        </View>

        {/* 12 color boxes */}
        <View style={styles.fieldText}>
          <Label className="text-white">Color</Label>
          <View style={{ gap: 8 }}>
            {[0, 1, 2].map((rowIndex) => (
              <View key={rowIndex} style={{ flexDirection: 'row', gap: 8 }}>
                {COLOR_OPTIONS.slice(rowIndex * 4, rowIndex * 4 + 4).map((color) => {
                  const isSelected = color === selectedColor;
                  return (
                    <Pressable
                      key={color}
                      onPress={() => setSelectedColor(color)}
                      style={[
                        styles.colorBox,
                        { backgroundColor: color },
                        isSelected && { borderWidth: 3, borderColor: '#fff' },
                      ]}
                    >
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        {/* Footer buttons */}
        <View style={styles.footer}>
          <Button
            onPress={() => handleOpenChange(false)}
            disabled={loading}
            style={{ flex: 1, backgroundColor: '#4a5263'}}
          >
            <Text>Cancel</Text>
          </Button>
          <Button
            onPress={handleCreate}
            disabled={!name.trim() || loading}
            style={{ flex: 1, backgroundColor: '#4a5263'}}
          >
            {loading
              ? <ActivityIndicator size="small" color="#ffffff" />
              : <Text>Create</Text>
            }
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  fabIcon: {
    color: '#25292e',
    fontSize: 30,
    fontWeight: '300',
    lineHeight: 34,
    marginTop: -2,
  },
  fieldText: {
    gap: 6,
    marginBottom: 16,
  },
  colorBox: {
    width: COLOR_BOX_SIZE,
    height: COLOR_BOX_SIZE,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
});