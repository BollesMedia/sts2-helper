export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      cards: {
        Row: {
          block: number | null
          color: string
          cost: number | null
          damage: number | null
          description: string
          description_raw: string | null
          game_version: string | null
          hit_count: number | null
          id: string
          image_url: string | null
          keywords: string[] | null
          name: string
          rarity: string
          star_cost: number | null
          tags: string[] | null
          target: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          block?: number | null
          color: string
          cost?: number | null
          damage?: number | null
          description: string
          description_raw?: string | null
          game_version?: string | null
          hit_count?: number | null
          id: string
          image_url?: string | null
          keywords?: string[] | null
          name: string
          rarity: string
          star_cost?: number | null
          tags?: string[] | null
          target?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          block?: number | null
          color?: string
          cost?: number | null
          damage?: number | null
          description?: string
          description_raw?: string | null
          game_version?: string | null
          hit_count?: number | null
          id?: string
          image_url?: string | null
          keywords?: string[] | null
          name?: string
          rarity?: string
          star_cost?: number | null
          tags?: string[] | null
          target?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cards_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      character_strategies: {
        Row: {
          display_name: string
          id: string
          strategy: string
          updated_at: string | null
        }
        Insert: {
          display_name: string
          id: string
          strategy: string
          updated_at?: string | null
        }
        Update: {
          display_name?: string
          id?: string
          strategy?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      characters: {
        Row: {
          game_version: string | null
          id: string
          name: string
          starting_deck: string[] | null
          starting_energy: number
          starting_gold: number
          starting_hp: number
          starting_relics: string[] | null
        }
        Insert: {
          game_version?: string | null
          id: string
          name: string
          starting_deck?: string[] | null
          starting_energy: number
          starting_gold: number
          starting_hp: number
          starting_relics?: string[] | null
        }
        Update: {
          game_version?: string | null
          id?: string
          name?: string
          starting_deck?: string[] | null
          starting_energy?: number
          starting_gold?: number
          starting_hp?: number
          starting_relics?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "characters_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      choices: {
        Row: {
          act: number
          choice_type: string
          chosen_item_id: string | null
          created_at: string | null
          evaluation_ids: string[] | null
          floor: number
          id: string
          offered_item_ids: string[]
          run_id: string | null
        }
        Insert: {
          act: number
          choice_type: string
          chosen_item_id?: string | null
          created_at?: string | null
          evaluation_ids?: string[] | null
          floor: number
          id?: string
          offered_item_ids: string[]
          run_id?: string | null
        }
        Update: {
          act?: number
          choice_type?: string
          chosen_item_id?: string | null
          created_at?: string | null
          evaluation_ids?: string[] | null
          floor?: number
          id?: string
          offered_item_ids?: string[]
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "choices_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      evaluations: {
        Row: {
          act: number
          archetypes: string[] | null
          character: string
          confidence: number
          context_hash: string
          created_at: string | null
          curse_count: number | null
          deck_size: number
          energy: number | null
          floor: number
          game_version: string | null
          gold: number | null
          has_scaling: boolean | null
          hp_percent: number
          id: string
          item_id: string
          item_name: string
          item_type: string
          primary_archetype: string | null
          reasoning: string
          recommendation: string
          relic_ids: string[] | null
          run_id: string | null
          source: string
          synergy_score: number
          tier_value: number
        }
        Insert: {
          act: number
          archetypes?: string[] | null
          character: string
          confidence: number
          context_hash: string
          created_at?: string | null
          curse_count?: number | null
          deck_size: number
          energy?: number | null
          floor: number
          game_version?: string | null
          gold?: number | null
          has_scaling?: boolean | null
          hp_percent: number
          id?: string
          item_id: string
          item_name: string
          item_type: string
          primary_archetype?: string | null
          reasoning: string
          recommendation: string
          relic_ids?: string[] | null
          run_id?: string | null
          source?: string
          synergy_score: number
          tier_value: number
        }
        Update: {
          act?: number
          archetypes?: string[] | null
          character?: string
          confidence?: number
          context_hash?: string
          created_at?: string | null
          curse_count?: number | null
          deck_size?: number
          energy?: number | null
          floor?: number
          game_version?: string | null
          gold?: number | null
          has_scaling?: boolean | null
          hp_percent?: number
          id?: string
          item_id?: string
          item_name?: string
          item_type?: string
          primary_archetype?: string | null
          reasoning?: string
          recommendation?: string
          relic_ids?: string[] | null
          run_id?: string | null
          source?: string
          synergy_score?: number
          tier_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "evaluations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      game_versions: {
        Row: {
          id: string
          synced_at: string | null
          version: string
        }
        Insert: {
          id?: string
          synced_at?: string | null
          version: string
        }
        Update: {
          id?: string
          synced_at?: string | null
          version?: string
        }
        Relationships: []
      }
      keywords: {
        Row: {
          description: string
          game_version: string | null
          id: string
          name: string
        }
        Insert: {
          description: string
          game_version?: string | null
          id: string
          name: string
        }
        Update: {
          description?: string
          game_version?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "keywords_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      monsters: {
        Row: {
          game_version: string | null
          id: string
          image_url: string | null
          max_hp: number | null
          min_hp: number | null
          moves: Json | null
          name: string
          type: string
          updated_at: string | null
        }
        Insert: {
          game_version?: string | null
          id: string
          image_url?: string | null
          max_hp?: number | null
          min_hp?: number | null
          moves?: Json | null
          name: string
          type: string
          updated_at?: string | null
        }
        Update: {
          game_version?: string | null
          id?: string
          image_url?: string | null
          max_hp?: number | null
          min_hp?: number | null
          moves?: Json | null
          name?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monsters_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      potions: {
        Row: {
          description: string
          game_version: string | null
          id: string
          image_url: string | null
          name: string
          pool: string | null
          rarity: string | null
          updated_at: string | null
        }
        Insert: {
          description: string
          game_version?: string | null
          id: string
          image_url?: string | null
          name: string
          pool?: string | null
          rarity?: string | null
          updated_at?: string | null
        }
        Update: {
          description?: string
          game_version?: string | null
          id?: string
          image_url?: string | null
          name?: string
          pool?: string | null
          rarity?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "potions_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      relics: {
        Row: {
          description: string
          game_version: string | null
          id: string
          image_url: string | null
          name: string
          pool: string | null
          rarity: string | null
          updated_at: string | null
        }
        Insert: {
          description: string
          game_version?: string | null
          id: string
          image_url?: string | null
          name: string
          pool?: string | null
          rarity?: string | null
          updated_at?: string | null
        }
        Update: {
          description?: string
          game_version?: string | null
          id?: string
          image_url?: string | null
          name?: string
          pool?: string | null
          rarity?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "relics_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      runs: {
        Row: {
          ascension_level: number | null
          bosses_fought: string[] | null
          character: string
          ended_at: string | null
          final_floor: number | null
          game_mode: string
          game_version: string | null
          id: string
          notes: string | null
          run_id: string
          started_at: string | null
          victory: boolean | null
        }
        Insert: {
          ascension_level?: number | null
          bosses_fought?: string[] | null
          character: string
          ended_at?: string | null
          final_floor?: number | null
          game_mode?: string
          game_version?: string | null
          id?: string
          notes?: string | null
          run_id: string
          started_at?: string | null
          victory?: boolean | null
        }
        Update: {
          ascension_level?: number | null
          bosses_fought?: string[] | null
          character?: string
          ended_at?: string | null
          final_floor?: number | null
          game_mode?: string
          game_version?: string | null
          id?: string
          notes?: string | null
          run_id?: string
          started_at?: string | null
          victory?: boolean | null
        }
        Relationships: []
      }
    }
    Views: {
      evaluation_stats: {
        Row: {
          act: number | null
          avg_confidence: number | null
          character: string | null
          eval_count: number | null
          item_id: string | null
          item_name: string | null
          most_common_rec: string | null
          primary_archetype: string | null
          tier_stddev: number | null
          weighted_synergy: number | null
          weighted_tier: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
