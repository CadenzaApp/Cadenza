import { addTag, deleteTag, getAllTags, Tag } from "@/lib/localdb";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import { Text, View, StyleSheet, TextInput, Button } from "react-native";

export default function TagsScreen() {
    const db = useSQLiteContext();

    const [newTagName, setNewTagName] = useState("");
    const [tags, setTags] = useState<Tag[]>([]);

    // initialize list of tags when first rendering this component
    useEffect(() => {
        getAllTags(db).then(setTags);
    }, []);

    async function onAddTag() {
        await addTag(db, newTagName);
        const newTags = await getAllTags(db);
        setTags(newTags);
    }

    async function onDeleteTag(id: number) {
        await deleteTag(db, id);
        const newTags = await getAllTags(db);
        setTags(newTags);
    }

    return (
        <View style={styles.container}>
            <Text style={styles.text}>Tags Screen</Text>

            <View style={styles.rowContainer}>
                <TextInput
                    style={styles.textInput}
                    placeholder="new tag name..."
                    onChangeText={setNewTagName}
                />
                <Button title="add" onPress={onAddTag} />
            </View>

            <Text style={styles.text}>Your tags:</Text>
            <View>
                {tags.map((tag) => (
                    <View key={tag.tid} style={styles.rowContainer}>
                        <Text style={styles.text}>{tag.name}</Text>
                        <Button title="x" onPress={() => onDeleteTag(tag.tid)} />
                    </View>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#25292e",
    },
    text: {
        color: "#fff",
    },
    rowContainer: {
        flexDirection: "row",
    },
    textInput: {
        outlineColor: "white",
        outlineWidth: 2,
        padding: 4
    }
});
